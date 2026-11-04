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

interface DatabaseSchema {
  calls: CallRecord[];
  appointments: AppointmentRecord[];
  contacts: ContactRecord[];
}

class DatabaseService {
  private filePath: string;
  private data: DatabaseSchema = {
    calls: [],
    appointments: [],
    contacts: []
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
      } else {
        this.save();
      }
    } catch (err) {
      console.warn('[Database] Failed to read database.json, initializing empty state:', err);
      this.data = { calls: [], appointments: [], contacts: [] };
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
}

export const dbService = new DatabaseService();
