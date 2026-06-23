What "implementing SMS" actually looks like

  When you pick a provider, you replace only the body of sendOtp. Two realistic shapes:

  Semaphore (popular/cheap in PH, plain REST):
  export async function sendOtp(phone: string, code: string): Promise<void> {
        const res = await fetch('https://api.semaphore.co/api/v4/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                        apikey: env.SEMAPHORE_API_KEY,
                        number: phone,                       // already E.164 from normalizePhone()
                        message: `Your Veent code is ${code}. It expires in 5 minutes.`
                })      
        });     
        if (!res.ok) throw new Error(`SMS send failed: ${res.status}`);
  }     
