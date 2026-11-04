# 🎙️ Aura - Full-Duplex AI Voice Caller

An enterprise-ready AI voice caller designed for **both Inbound and Outbound** carrier phone calls with human-grade latency, natural interruptions (barge-in), live appointment booking, customer CRM lookup, and call transfer.

---

## 🌟 Key Features

- **Dual-Direction Telephony**:
  - **Inbound Calls**: Answers calls instantly on your Twilio phone number.
  - **Outbound Calls**: Dial any global phone number via the Web Dashboard or REST API.
- **Full-Duplex Speech-to-Speech**:
  - Powered by **OpenAI Realtime API** (`gpt-4o-realtime-preview-2024-12-17`).
  - Native G.711 μ-law direct audio streaming (no lossy conversions, sub-second latency).
  - **Barge-In Interruption Detection**: AI stops speaking immediately when the human starts talking.
- **Realtime Voice Tools (Function Calling)**:
  - 📅 `book_appointment`: Books and reserves appointments directly into the database.
  - 🔍 `lookup_customer`: Identifies returning callers and their history.
  - 💬 `send_sms_confirmation`: Dispatches SMS confirmations during or after the call.
  - 🔀 `transfer_call_to_human`: Seamlessly transfers live callers to a human supervisor.
- **Post-Call Intelligence**:
  - Verbatim timestamped transcript.
  - Automated AI summary & sentiment analysis (`positive`, `neutral`, `negative`, `escalated`).
- **Web Command Center**:
  - Interactive dashboard to place calls, view live transcripts, and customize AI prompts on the fly.

---

## 🛠️ Quick Setup Guide

### Step 1: Create Accounts & Get API Keys

1. **OpenAI Account**:
   - Go to [platform.openai.com](https://platform.openai.com) and create an API Key.
   - Set in `.env`:
     ```env
     OPENAI_API_KEY=sk-...
     ```

2. **Twilio Account**:
   - Go to [twilio.com](https://www.twilio.com) and sign up (comes with free trial credits).
   - In the Twilio Console, copy:
     - **Account SID**
     - **Auth Token**
   - Buy one phone number under **Phone Numbers > Manage > Buy a number** (make sure **Voice** capability is checked).
   - Set in `.env`:
     ```env
     TWILIO_ACCOUNT_SID=AC...
     TWILIO_AUTH_TOKEN=...
     TWILIO_PHONE_NUMBER=+1...
     ```

---

### Step 2: Run Locally with ngrok (for testing live phone calls)

1. Start the server:
   ```bash
   npm run dev
   ```

2. Open an ngrok tunnel so Twilio can connect to your local machine:
   ```bash
   npx ngrok http 3000
   ```
   *(Copy the forwarding HTTPS URL, e.g. `https://xxxx.ngrok-free.app`)*

3. Put that URL into your `.env`:
   ```env
   PUBLIC_URL=https://xxxx.ngrok-free.app
   ```

4. Configure your Twilio Phone Number:
   - In the Twilio Console, go to **Phone Numbers > Active numbers > Click your number**.
   - Under **Voice Configuration**, set:
     - **A CALL COMES IN**: `Webhook`
     - **URL**: `https://xxxx.ngrok-free.app/twiml/incoming`
     - **HTTP Method**: `POST`
   - Click **Save**.

---

### Step 3: Test It!

1. Open your browser at **http://localhost:3000**.
2. **Inbound test**: Call your Twilio phone number from your mobile phone. Aura will answer and speak with you in real time.
3. **Outbound test**: On the Web Dashboard, enter your mobile number and click **"Call Now"**. Your phone will ring within 2 seconds.

---

## ☁️ 1-Click Cloud Deployment

Deploy directly to **Railway**, **Render**, or **Fly.io**:

1. Push this repo to GitHub.
2. In [Railway.app](https://railway.app), click **New Project > Deploy from GitHub repo**.
3. Add your environment variables (`OPENAI_API_KEY`, `TWILIO_ACCOUNT_SID`, etc.).
4. Railway provides a persistent HTTPS domain with automatic WebSockets.
5. In Twilio, point your phone number's webhook to `https://your-railway-app.up.railway.app/twiml/incoming`.
