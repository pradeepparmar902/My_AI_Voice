// Aura AI Voice Dashboard Client

const DEFAULT_PROMPT = `You are "Aura", a warm, natural, and highly capable AI voice assistant.
Your goal is to assist callers in a friendly, concise, and conversational manner.
Guidelines:
- Keep responses short, natural, and conversational (1 to 2 sentences per turn is best for phone conversations).
- Do not use markdown, emojis, bullet points, or complex symbols in spoken text.
- If the user asks to book an appointment, check availability, or transfer to a human, use the provided tools.
- If you don't know the answer, be honest and offer to connect them to a specialist.`;

const PRESET_PROMPTS = {
  receptionist: DEFAULT_PROMPT,
  booking: `You are "Aura", an intelligent booking concierge.
Your primary objective is to help callers schedule appointments for dental checkups, consultations, or service visits.
Always ask for:
1. Customer full name
2. Preferred date and time
3. Exact reason or service needed
Once confirmed, call the 'book_appointment' tool to record it and offer an SMS confirmation. Keep conversation natural and brief.`,
  sales: `You are "Aura", a high-energy, polite sales qualification specialist.
Your goal is to qualify outbound leads interested in our AI automation services:
1. Ask what their biggest bottleneck in customer support or operations is.
2. Share how our voice agents handle 24/7 call volume with sub-second latency.
3. Book a 15-minute executive demo with a human specialist using the booking tool. Keep responses under 2 sentences.`,
  custom: ''
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  fetchSystemStatus();
  fetchCalls();
  fetchAppointments();
  fetchContacts();
  initFormListeners();

  // Auto-refresh logs every 6 seconds
  setInterval(() => {
    fetchCalls();
    fetchAppointments();
  }, 6000);
});

// Fetch system config and status
async function fetchSystemStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    const statusBadges = document.getElementById('statusBadges');
    statusBadges.innerHTML = `
      <span class="badge ${data.openaiConfigured ? 'badge-success' : 'badge-danger'}">
        ● OpenAI Realtime: ${data.openaiConfigured ? 'Connected' : 'Missing API Key'}
      </span>
      <span class="badge ${data.twilioConfigured ? 'badge-success' : 'badge-danger'}">
        ● Twilio Voice: ${data.twilioConfigured ? `Ready (${data.twilioNumber})` : 'Missing Credentials'}
      </span>
    `;

    // Update Webhook URL Display
    const inboundUrl = window.location.origin + '/twiml/incoming';
    document.getElementById('inboundUrlDisplay').textContent = inboundUrl;

    if (!document.getElementById('systemPromptInput').value) {
      document.getElementById('systemPromptInput').value = DEFAULT_PROMPT;
    }
  } catch (err) {
    console.error('Failed to fetch status:', err);
  }
}

// Fetch Call History
async function fetchCalls() {
  try {
    const res = await fetch('/api/calls');
    const calls = await res.json();

    document.getElementById('totalCallsCount').textContent = calls.length;

    const tbody = document.getElementById('callsTableBody');
    if (calls.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No calls recorded yet. Place an outbound call or dial inbound to test!</td></tr>`;
      return;
    }

    tbody.innerHTML = calls.map(c => `
      <tr>
        <td>
          <span class="pill ${c.direction === 'inbound' ? 'pill-success' : 'pill-primary'}">
            ${c.direction === 'inbound' ? '⬇ Inbound' : '⬆ Outbound'}
          </span>
        </td>
        <td>
          <strong>${c.direction === 'inbound' ? c.from_number : c.to_number}</strong>
        </td>
        <td>
          <span class="pill ${c.status === 'completed' ? 'pill-success' : 'pill-primary'}">${c.status}</span>
        </td>
        <td>${c.duration ? `${c.duration}s` : '—'}</td>
        <td>${new Date(c.created_at).toLocaleString()}</td>
        <td>
          <span class="badge ${getSentimentBadge(c.sentiment)}">${c.sentiment || 'neutral'}</span>
        </td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="viewCallDetails('${c.call_sid}')">View Details</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error fetching calls:', err);
  }
}

function getSentimentBadge(sentiment) {
  if (sentiment === 'positive') return 'badge-success';
  if (sentiment === 'negative' || sentiment === 'escalated') return 'badge-danger';
  return 'badge-warning';
}

// Fetch Booked Appointments
async function fetchAppointments() {
  try {
    const res = await fetch('/api/appointments');
    const appts = await res.json();

    document.getElementById('appointmentsCount').textContent = appts.length;

    const tbody = document.getElementById('appointmentsTableBody');
    if (appts.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No appointments booked yet. The AI can schedule them automatically during calls.</td></tr>`;
      return;
    }

    tbody.innerHTML = appts.map(a => `
      <tr>
        <td><strong>${escapeHtml(a.customer_name)}</strong></td>
        <td>${escapeHtml(a.caller_phone)}</td>
        <td><span class="pill pill-primary">${escapeHtml(a.service)}</span></td>
        <td><strong>${escapeHtml(a.date_time)}</strong></td>
        <td>${escapeHtml(a.notes || '—')}</td>
        <td>${new Date(a.created_at).toLocaleDateString()}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error fetching appointments:', err);
  }
}

// Fetch Contacts
async function fetchContacts() {
  try {
    const res = await fetch('/api/contacts');
    const contacts = await res.json();
    document.getElementById('contactsCount').textContent = contacts.length;
  } catch (err) {
    console.error('Error fetching contacts:', err);
  }
}

// Event Listeners
function initFormListeners() {
  // Preset prompt change
  const presetSelect = document.getElementById('personaPreset');
  const customGroup = document.getElementById('customPromptGroup');

  presetSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'custom') {
      customGroup.style.display = 'block';
    } else {
      customGroup.style.display = 'none';
      document.getElementById('systemPromptInput').value = PRESET_PROMPTS[val];
    }
  });

  // Outbound Call submit
  document.getElementById('outboundForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const phoneInput = document.getElementById('phoneNumber');
    const callBtn = document.getElementById('callBtn');
    const feedback = document.getElementById('callFeedback');
    const phoneNumber = phoneInput.value.trim();

    callBtn.disabled = true;
    callBtn.innerHTML = `<span>⏳</span> Dialing Carrier...`;
    feedback.style.display = 'none';

    try {
      const res = await fetch('/api/calls/outbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: phoneNumber })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to place call');
      }

      feedback.className = 'feedback-banner success';
      feedback.textContent = `Call initiated! Call SID: ${data.callSid}. The phone is ringing.`;
      feedback.style.display = 'block';
      phoneInput.value = '';
      setTimeout(fetchCalls, 1500);
    } catch (err) {
      feedback.className = 'feedback-banner error';
      feedback.textContent = err.message;
      feedback.style.display = 'block';
    } finally {
      callBtn.disabled = false;
      callBtn.innerHTML = `<span class="btn-icon">⚡</span> Call Now`;
    }
  });

  // System Prompt form
  document.getElementById('promptForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const prompt = document.getElementById('systemPromptInput').value;

    try {
      const res = await fetch('/api/config/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      const data = await res.json();
      alert('AI persona prompt updated successfully!');
    } catch (err) {
      alert('Failed to update prompt.');
    }
  });
}

// Modal view call details
async function viewCallDetails(sid) {
  const modal = document.getElementById('transcriptModal');
  const modalBody = document.getElementById('modalBody');
  modal.style.display = 'flex';
  modalBody.innerHTML = `<div class="loader">Loading details for ${sid}...</div>`;

  try {
    const res = await fetch(`/api/calls/${sid}`);
    const call = await res.json();

    modalBody.innerHTML = `
      <div style="display: flex; gap: 12px; flex-wrap: wrap;">
        <div><strong>Direction:</strong> ${call.direction.toUpperCase()}</div>
        <div><strong>From:</strong> ${call.from_number}</div>
        <div><strong>To:</strong> ${call.to_number}</div>
        <div><strong>Duration:</strong> ${call.duration || 0} seconds</div>
        <div><strong>Sentiment:</strong> <span class="badge ${getSentimentBadge(call.sentiment)}">${call.sentiment || 'neutral'}</span></div>
      </div>

      <div>
        <strong>AI Call Summary:</strong>
        <p style="margin-top: 6px; color: #d1d5db;">${escapeHtml(call.summary || 'Summary is being generated or was not available.')}</p>
      </div>

      <div>
        <strong>Full Verbatim Transcript:</strong>
        <div class="transcript-box">${escapeHtml(call.transcript || 'No speech recorded on this call.')}</div>
      </div>
    `;
  } catch (err) {
    modalBody.innerHTML = `<div class="feedback-banner error">Failed to load details.</div>`;
  }
}

function closeModal() {
  document.getElementById('transcriptModal').style.display = 'none';
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  if (tab === 'calls') {
    document.querySelectorAll('.tab-btn')[0].classList.add('active');
    document.getElementById('callsTab').classList.add('active');
  } else {
    document.querySelectorAll('.tab-btn')[1].classList.add('active');
    document.getElementById('appointmentsTab').classList.add('active');
  }
}

function loadDefaultPrompt() {
  document.getElementById('systemPromptInput').value = DEFAULT_PROMPT;
}

function refreshData() {
  fetchCalls();
  fetchAppointments();
  fetchContacts();
}

function copyWebhook() {
  const text = document.getElementById('inboundUrlDisplay').textContent;
  navigator.clipboard.writeText(text);
  alert('Inbound webhook URL copied to clipboard!');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
