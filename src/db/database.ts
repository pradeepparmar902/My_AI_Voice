import path from 'path';
import fs from 'fs';

export interface CallRecord {
  id: string;
  call_sid: string;
  direction: 'inbound' | 'outbound';
  from_number: string;
  to_number: string;
  status: string;
  duration?: number;
  transcript?: string;
  summary?: string;
  sentiment?: string;
  created_at: string;
}

export interface AppointmentRecord {
  id: string;
  caller_phone: string;
  customer_name: string;
  service: string;
  date_time: string;
  notes?: string;
  created_at: string;
}

export interface ContactRecord {
  id: string;
  phone: string;
  name?: string;
  email?: string;
  notes?: string;
  last_contacted: string;
}

export interface KnowledgeRecord {
  id: string;
  title: string;
  content: string;
  category?: string;
  created_at: string;
}

interface DatabaseSchema {
  calls: CallRecord[];
  appointments: AppointmentRecord[];
  contacts: ContactRecord[];
  knowledge: KnowledgeRecord[];
}

class DatabaseService {
  private filePath: string;
  private data: DatabaseSchema = {
    calls: [],
    appointments: [],
    contacts: [],
    knowledge: []
  };

  constructor() {
    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.filePath = path.join(dataDir, 'database.json');
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, 'utf-8');
        this.data = JSON.parse(content);
        if (!Array.isArray(this.data.knowledge)) {
          this.data.knowledge = [];
        }
      } else {
        this.save();
      }
    } catch (err) {
      console.warn('[Database] Failed to read database.json, initializing empty state:', err);
      this.data = { calls: [], appointments: [], contacts: [], knowledge: [] };
    }
  }

  private save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Database] Failed to persist data:', err);
    }
  }

  // --- Calls ---
  public createCall(record: Omit<CallRecord, 'id' | 'created_at'>): CallRecord {
    const existing = this.data.calls.find((c) => c.call_sid === record.call_sid);
    if (existing) {
      return existing;
    }

    const newRecord: CallRecord = {
      ...record,
      id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      created_at: new Date().toISOString()
    };

    this.data.calls.unshift(newRecord);
    this.save();
    return newRecord;
  }

  public updateCallStatus(callSid: string, status: string, duration?: number) {
    const call = this.data.calls.find((c) => c.call_sid === callSid);
    if (call) {
      call.status = status;
      if (typeof duration === 'number') {
        call.duration = duration;
      }
      this.save();
    }
  }

  public saveCallTranscriptAndSummary(callSid: string, transcript: string, summary: string, sentiment: string) {
    const call = this.data.calls.find((c) => c.call_sid === callSid);
    if (call) {
      call.transcript = transcript;
      call.summary = summary;
      call.sentiment = sentiment;
      this.save();

      // Also export an individual human-readable text file in data/transcripts/
      try {
        const transcriptsDir = path.resolve(process.cwd(), 'data', 'transcripts');
        if (!fs.existsSync(transcriptsDir)) {
          fs.mkdirSync(transcriptsDir, { recursive: true });
        }

        const safeFilename = `transcript_${callSid}.txt`;
        const filePath = path.join(transcriptsDir, safeFilename);

        const content = `=====================================================
CALL TRANSCRIPT & ANALYSIS
=====================================================
Call ID:    ${callSid}
Date/Time:  ${call.created_at}
Direction:  ${call.direction.toUpperCase()}
From:       ${call.from_number}
To:         ${call.to_number}
Duration:   ${call.duration || 0} seconds
Sentiment:  ${sentiment.toUpperCase()}

AI SUMMARY:
${summary}

=====================================================
VERBATIM CONVERSATION LOG
=====================================================
${transcript}
=====================================================
`;
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`[Database] Transcript exported to file: ${filePath}`);
      } catch (err) {
        console.error('[Database] Failed to write individual transcript file:', err);
      }
    }
  }

  public getAllCalls(): CallRecord[] {
    return [...this.data.calls];
  }

  public getCallBySid(callSid: string): CallRecord | undefined {
    return this.data.calls.find((c) => c.call_sid === callSid);
  }

  // --- Appointments ---
  public createAppointment(appt: Omit<AppointmentRecord, 'id' | 'created_at'>): AppointmentRecord {
    const newAppt: AppointmentRecord = {
      ...appt,
      id: `appt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      created_at: new Date().toISOString()
    };
    this.data.appointments.unshift(newAppt);
    this.save();
    return newAppt;
  }

  public getAllAppointments(): AppointmentRecord[] {
    return [...this.data.appointments];
  }

  // --- Contacts ---
  public getContactByPhone(phone: string): ContactRecord | undefined {
    return this.data.contacts.find((c) => c.phone === phone);
  }

  public upsertContact(phone: string, name?: string, notes?: string): ContactRecord {
    let contact = this.data.contacts.find((c) => c.phone === phone);
    if (contact) {
      if (name) contact.name = name;
      if (notes) contact.notes = notes;
      contact.last_contacted = new Date().toISOString();
    } else {
      contact = {
        id: `cnt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        phone,
        name: name || '',
        notes: notes || '',
        last_contacted: new Date().toISOString()
      };
      this.data.contacts.unshift(contact);
    }
    this.save();
    return contact;
  }

  public getAllContacts(): ContactRecord[] {
    return [...this.data.contacts];
  }

  // --- Knowledge Base ---
  public addKnowledge(item: Omit<KnowledgeRecord, 'id' | 'created_at'>): KnowledgeRecord {
    const newDoc: KnowledgeRecord = {
      ...item,
      id: `doc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      created_at: new Date().toISOString()
    };
    this.data.knowledge.unshift(newDoc);
    this.save();
    return newDoc;
  }

  public getAllKnowledge(): KnowledgeRecord[] {
    return [...this.data.knowledge];
  }

  public getKnowledgeById(id: string): KnowledgeRecord | undefined {
    return this.data.knowledge.find((k) => k.id === id);
  }

  public deleteKnowledge(id: string): boolean {
    const initialLen = this.data.knowledge.length;
    this.data.knowledge = this.data.knowledge.filter((k) => k.id !== id);
    if (this.data.knowledge.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }
}

export const dbService = new DatabaseService();
