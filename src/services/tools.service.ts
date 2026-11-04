import { dbService } from '../db/database.js';
import { twilioService } from './twilio.service.js';

// OpenAI Realtime Tool Definitions (Function schemas)
export const voiceTools = [
  {
    type: 'function',
    name: 'book_appointment',
    description: 'Book an appointment or reservation for the caller.',
    parameters: {
      type: 'object',
      properties: {
        customer_name: {
          type: 'string',
          description: 'The name of the customer.'
        },
        service: {
          type: 'string',
          description: 'The service, consultation type, or meeting reason requested.'
        },
        date_time: {
          type: 'string',
          description: 'The requested date and time for the appointment (e.g., "Tomorrow at 3pm" or "2026-11-06 15:00").'
        },
        notes: {
          type: 'string',
          description: 'Any special requests or details.'
        }
      },
      required: ['customer_name', 'service', 'date_time']
    }
  },
  {
    type: 'function',
    name: 'check_availability',
    description: 'Check available time slots for appointments on a specific date.',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'The date to check availability for (e.g., "today", "tomorrow", "Friday").'
        }
      },
      required: ['date']
    }
  },
  {
    type: 'function',
    name: 'lookup_customer',
    description: 'Look up customer details, past history, and notes by phone number.',
    parameters: {
      type: 'object',
      properties: {
        phone: {
          type: 'string',
          description: 'The customer phone number.'
        }
      },
      required: ['phone']
    }
  },
  {
    type: 'function',
    name: 'send_sms_confirmation',
    description: 'Send an SMS confirmation or link directly to the caller phone number.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The message text to send.'
        }
      },
      required: ['message']
    }
  },
  {
    type: 'function',
    name: 'transfer_call_to_human',
    description: 'Transfer the live phone call to a human supervisor or specialist when requested or escalated.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'The reason for transferring the call.'
        }
      },
      required: ['reason']
    }
  }
];

export async function executeTool(name: string, args: any, context: { callSid: string; callerPhone: string }) {
  console.log(`[Tool Execution] Calling tool: ${name} with args:`, args);

  switch (name) {
    case 'book_appointment': {
      dbService.createAppointment({
        caller_phone: context.callerPhone,
        customer_name: args.customer_name,
        service: args.service,
        date_time: args.date_time,
        notes: args.notes || ''
      });

      dbService.upsertContact(context.callerPhone, args.customer_name, `Booked ${args.service}`);

      return {
        success: true,
        message: `Appointment successfully booked for ${args.customer_name} for ${args.service} on ${args.date_time}.`
      };
    }

    case 'check_availability': {
      // In a production app, connect to Google Calendar or Cal.com here.
      // Providing realistic dynamic slots:
      return {
        date: args.date,
        available_slots: ['10:00 AM', '1:30 PM', '3:00 PM', '4:30 PM'],
        status: 'open'
      };
    }

    case 'lookup_customer': {
      const contact = dbService.getContactByPhone(args.phone || context.callerPhone);
      if (contact) {
        return {
          found: true,
          name: contact.name,
          notes: contact.notes,
          last_contacted: contact.last_contacted
        };
      }
      return { found: false, message: 'New customer with no prior records.' };
    }

    case 'send_sms_confirmation': {
      try {
        await twilioService.sendSms(context.callerPhone, args.message);
        return { success: true, message: `SMS sent to ${context.callerPhone}` };
      } catch (err: any) {
        console.error('Failed to send SMS:', err.message);
        return { success: false, error: err.message };
      }
    }

    case 'transfer_call_to_human': {
      try {
        await twilioService.transferCall(context.callSid);
        return { success: true, message: 'Call is being transferred to a live human representative now.' };
      } catch (err: any) {
        console.error('Failed to transfer call:', err.message);
        return { success: false, error: err.message };
      }
    }

    default:
      return { error: `Tool ${name} not recognized.` };
  }
}
