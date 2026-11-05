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

// State for active simulated call
let simState = {
  active: false,
  callSid: null,
  direction: 'inbound',
  startTime: null,
  timerInterval: null,
  transcript: [],
  recognition: null,
  isListening: false,
  selectedLang: 'auto',
  speechAccumulator: '',
  silenceTimer: null
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  fetchSystemStatus();
  fetchCalls();
  fetchAppointments();
  fetchContacts();
  fetchKnowledge();
  initFormListeners();
  initSpeechRecognition();

  // Auto-refresh logs every 6 seconds
  setInterval(() => {
    fetchCalls();
    fetchAppointments();
    fetchKnowledge();
  }, 6000);
});

// Setup Speech Recognition with Conversational Pause Buffering (Human-grade VAD)
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Web Speech API not supported in this browser. Fallback to text input available.');
    return;
  }

  simState.recognition = new SpeechRecognition();
  simState.recognition.continuous = true;
  simState.recognition.interimResults = true;
  simState.recognition.lang = 'en-IN';

  simState.recognition.onresult = (event) => {
    if (!simState.active) return;

    let finalChunk = '';
    let interimChunk = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalChunk += ' ' + event.results[i][0].transcript;
      } else {
        interimChunk += ' ' + event.results[i][0].transcript;
      }
    }

    if (finalChunk.trim()) {
      simState.speechAccumulator = simState.speechAccumulator 
        ? `${simState.speechAccumulator} ${finalChunk.trim()}` 
        : finalChunk.trim();

      updateSimStatus(`Listening: "${simState.speechAccumulator}"...`, false);

      // Human thinking pause timer (1500ms): Wait until speaker genuinely finishes their thought
      clearTimeout(simState.silenceTimer);
      simState.silenceTimer = setTimeout(() => {
        const fullSentence = simState.speechAccumulator.trim();
        simState.speechAccumulator = '';
        if (fullSentence.length > 0) {
          // Ignore accidental 1-letter / background noise clicks unless it's a real word
          if (fullSentence.length <= 2 && !['hi', 'no', 'ok', 'ha', 'ji'].includes(fullSentence.toLowerCase())) {
            updateSimStatus('Listening for your voice...', false);
            return;
          }
          handleUserSpeech(fullSentence);
        }
      }, 1400);
    } else if (interimChunk.trim()) {
      // User is actively speaking right now
      clearTimeout(simState.silenceTimer);
      const preview = (simState.speechAccumulator ? simState.speechAccumulator + ' ' : '') + interimChunk.trim();
      updateSimStatus(`Hearing: "${preview}"...`, false);
    }
  };

  simState.recognition.onerror = (event) => {
    console.warn('Speech recognition error:', event.error);
    if (simState.isListening) {
      try { simState.recognition.start(); } catch (_) {}
    }
  };

  simState.recognition.onend = () => {
    if (simState.active && simState.isListening) {
      try { simState.recognition.start(); } catch (_) {}
    }
  };
}

function changeSimLanguage(lang) {
  simState.selectedLang = lang;
  if (simState.recognition) {
    simState.recognition.lang = lang === 'auto' ? 'en-IN' : lang;
  }
}

function quickSend(text) {
  if (!simState.active) {
    startSimulatedCall('inbound');
  }
  setTimeout(() => {
    handleUserSpeech(text);
  }, 400);
}

// Speak aloud using browser TTS with multilingual regional voice support
function speakAloud(text, callback, lang = 'en') {
  if (!('speechSynthesis' in window)) {
    if (callback) callback();
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  const voices = window.speechSynthesis.getVoices();
  let matchedVoice = null;

  if (lang === 'gu') {
    utterance.lang = 'gu-IN';
    matchedVoice = voices.find(v => v.lang.startsWith('gu') || v.name.includes('Gujarati'));
  } else if (lang === 'hi') {
    utterance.lang = 'hi-IN';
    matchedVoice = voices.find(v => v.lang.startsWith('hi') || v.name.includes('Hindi') || v.name.includes('Swara') || v.name.includes('Madhur'));
  } else if (lang === 'mr') {
    utterance.lang = 'mr-IN';
    matchedVoice = voices.find(v => v.lang.startsWith('mr') || v.name.includes('Marathi') || v.name.includes('Aarohi'));
  } else {
    utterance.lang = 'en-IN';
    matchedVoice = voices.find(v => (v.lang === 'en-IN' || v.lang.startsWith('en')) && (v.name.includes('Natural') || v.name.includes('Samantha') || v.name.includes('Neerja')));
  }

  if (matchedVoice) {
    utterance.voice = matchedVoice;
  }

  updateSimStatus('AI is Speaking...', true);

  utterance.onend = () => {
    updateSimStatus('Listening for your voice...', false);
    if (callback) callback();
  };

  utterance.onerror = () => {
    updateSimStatus('Listening for your voice...', false);
    if (callback) callback();
  };

  window.speechSynthesis.speak(utterance);
}

// Start Local In-Browser Simulator Call
function startSimulatedCall(direction) {
  if (simState.active) return;

  simState.active = true;
  simState.callSid = `sim_${Date.now()}`;
  simState.direction = direction;
  simState.startTime = Date.now();
  simState.transcript = [];

  document.getElementById('simCallControls').style.display = 'none';
  document.getElementById('simActivePanel').style.display = 'flex';
  document.getElementById('simCallTitle').textContent = direction === 'inbound' 
    ? 'Incoming Call from +1-LOCAL-USER' 
    : 'Calling Out to +1-LOCAL-USER';
  document.getElementById('simTranscriptFeed').innerHTML = '';

  // Start timer
  simState.timerInterval = setInterval(updateSimTimer, 1000);

  // Initial greeting
  const greeting = direction === 'inbound'
    ? "Hello! Thanks for calling. My name is Aura, your AI voice assistant. How can I help you today?"
    : "Hi there! This is Aura following up regarding your inquiry. How are you doing today?";

  addSimMessage('assistant', greeting);
  speakAloud(greeting, () => {
    startListening();
  });
}

function updateSimTimer() {
  const elapsed = Math.floor((Date.now() - simState.startTime) / 1000);
  const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const secs = String(elapsed % 60).padStart(2, '0');
  document.getElementById('simTimer').textContent = `${mins}:${secs}`;
}

function updateSimStatus(text, isSpeaking) {
  const indicator = document.getElementById('simStatusText');
  const wave = document.querySelector('.voice-wave');
  if (indicator) indicator.textContent = text;
  if (wave) wave.style.opacity = isSpeaking ? '1' : '0.4';
}

function startListening() {
  if (!simState.recognition) return;
  try {
    simState.recognition.start();
    simState.isListening = true;
    const micBtn = document.getElementById('simMicBtn');
    micBtn.classList.add('active');
    document.getElementById('micText').textContent = 'Listening...';
  } catch (_) {}
}

function stopListening() {
  if (!simState.recognition) return;
  simState.isListening = false;
  try { simState.recognition.stop(); } catch (_) {}
  const micBtn = document.getElementById('simMicBtn');
  micBtn.classList.remove('active');
  document.getElementById('micText').textContent = 'Mic Off';
}

function toggleMicrophone() {
  if (simState.isListening) {
    stopListening();
  } else {
    startListening();
  }
}

// Handle User speech turn
async function handleUserSpeech(userText) {
  if (!simState.active) return;
  stopListening();

  addSimMessage('user', userText);

  try {
    const res = await fetch('/api/simulator/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callerPhone: '+1-LOCAL-USER',
        callSid: simState.callSid,
        userText,
        history: simState.transcript
      })
    });

    const data = await res.json();

    if (data.toolExecuted) {
      addSimMessage('tool', `⚙️ Tool executed: ${data.toolExecuted} (${JSON.stringify(data.toolResult || {})})`);
      fetchAppointments();
      fetchContacts();
    }

    addSimMessage('assistant', data.replyText);
    speakAloud(data.replyText, () => {
      if (simState.active) {
        startListening();
      }
    }, data.lang || 'en');
  } catch (err) {
    console.error('Simulator chat error:', err);
    startListening();
  }
}

function sendSimText() {
  const input = document.getElementById('simTextInput');
  const text = input.value.trim();
  if (text) {
    input.value = '';
    handleUserSpeech(text);
  }
}

function addSimMessage(role, text) {
  const feed = document.getElementById('simTranscriptFeed');
  const div = document.createElement('div');
  const time = new Date().toLocaleTimeString();

  if (role === 'user') {
    div.className = 'sim-msg sim-msg-user';
    div.innerHTML = `<strong>You:</strong> ${escapeHtml(text)}`;
    simState.transcript.push(`[${time}] USER: ${text}`);
  } else if (role === 'assistant') {
    div.className = 'sim-msg sim-msg-ai';
    div.innerHTML = `<strong>Aura:</strong> ${escapeHtml(text)}`;
    simState.transcript.push(`[${time}] AURA: ${text}`);
  } else {
    div.className = 'sim-msg sim-msg-tool';
    div.innerHTML = escapeHtml(text);
  }

  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
}

// End Simulated Call
async function endSimulatedCall() {
  if (!simState.active) return;

  clearTimeout(simState.silenceTimer);
  simState.speechAccumulator = '';
  stopListening();
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }

  clearInterval(simState.timerInterval);
  const duration = Math.max(1, Math.floor((Date.now() - simState.startTime) / 1000));
  const fullTranscript = simState.transcript.join('\n');

  try {
    await fetch('/api/simulator/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callSid: simState.callSid,
        callerPhone: '+1-LOCAL-USER',
        transcript: fullTranscript,
        durationSeconds: duration
      })
    });
  } catch (err) {
    console.error('Failed to end simulated call:', err);
  }

  simState.active = false;
  document.getElementById('simActivePanel').style.display = 'none';
  document.getElementById('simCallControls').style.display = 'flex';

  // Refresh tables
  fetchCalls();
  fetchAppointments();
  fetchContacts();
}

// Fetch system config and status
async function fetchSystemStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    const statusBadges = document.getElementById('statusBadges');
    statusBadges.innerHTML = `
      <span class="badge ${data.openaiConfigured ? 'badge-success' : 'badge-warning'}">
        ● OpenAI: ${data.openaiConfigured ? 'Connected' : 'Free Simulator Mode'}
      </span>
      <span class="badge ${data.twilioConfigured ? 'badge-success' : 'badge-warning'}">
        ● Twilio: ${data.twilioConfigured ? `Ready (${data.twilioNumber})` : 'Webphone Mode'}
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
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No calls recorded yet. Click 'Simulate Inbound Call' above to test right now!</td></tr>`;
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

// Fetch Knowledge Base
async function fetchKnowledge() {
  try {
    const res = await fetch('/api/knowledge');
    const docs = await res.json();

    document.getElementById('knowledgeCount').textContent = docs.length;
    document.getElementById('kbTabCount').textContent = docs.length;

    const container = document.getElementById('kbListContainer');
    if (!docs.length) {
      container.innerHTML = `<div class="empty-state">No knowledge documents uploaded yet. Upload a file or add an entry on the left to train the AI!</div>`;
      return;
    }

    container.innerHTML = docs.map(doc => `
      <div class="kb-article-card">
        <div class="kb-article-header">
          <span class="kb-article-title">${escapeHtml(doc.title)}</span>
          <span class="pill pill-primary">${escapeHtml(doc.category || 'General')}</span>
        </div>
        <div class="kb-article-preview">${escapeHtml(doc.content)}</div>
        <div class="kb-article-footer">
          <span>Added: ${new Date(doc.created_at).toLocaleDateString()}</span>
          <button class="btn-del-kb" onclick="deleteKnowledge('${doc.id}')">🗑️ Remove</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error fetching knowledge:', err);
  }
}

// Upload file handler
async function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/knowledge/upload', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      throw new Error('Upload failed');
    }

    alert(`Successfully uploaded "${file.name}" to the AI knowledge base!`);
    fetchKnowledge();
  } catch (err) {
    alert(`File upload failed: ${err.message}`);
  } finally {
    e.target.value = '';
  }
}

// Delete Knowledge Item
async function deleteKnowledge(id) {
  if (!confirm('Are you sure you want to remove this knowledge document?')) return;

  try {
    const res = await fetch(`/api/knowledge/${id}`, { method: 'DELETE' });
    if (res.ok) {
      fetchKnowledge();
    }
  } catch (err) {
    alert('Failed to delete document.');
  }
}

// Event Listeners
function initFormListeners() {
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

  // Outbound Call submit (Twilio)
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
      alert('AI persona prompt updated successfully!');
    } catch (err) {
      alert('Failed to update prompt.');
    }
  });

  // Knowledge Base manual add form
  const kbForm = document.getElementById('kbAddForm');
  if (kbForm) {
    kbForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('kbTitle').value.trim();
      const category = document.getElementById('kbCategory').value;
      const content = document.getElementById('kbContent').value.trim();

      try {
        const res = await fetch('/api/knowledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, category, content })
        });

        if (!res.ok) throw new Error('Failed to add knowledge');

        alert(`Knowledge article "${title}" added to AI!`);
        document.getElementById('kbTitle').value = '';
        document.getElementById('kbContent').value = '';
        fetchKnowledge();
      } catch (err) {
        alert(err.message);
      }
    });
  }
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
  } else if (tab === 'appointments') {
    document.querySelectorAll('.tab-btn')[1].classList.add('active');
    document.getElementById('appointmentsTab').classList.add('active');
  } else if (tab === 'knowledge') {
    document.querySelectorAll('.tab-btn')[2].classList.add('active');
    document.getElementById('knowledgeTab').classList.add('active');
  }
}

function loadDefaultPrompt() {
  document.getElementById('systemPromptInput').value = DEFAULT_PROMPT;
}

function refreshData() {
  fetchCalls();
  fetchAppointments();
  fetchContacts();
  fetchKnowledge();
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
