# **Cast SMS API — Developer Documentation** 

**Base URL:** `https://api.cast.ph` **Current Version:** v1 

## **Overview** 

The Cast API lets you send SMS, OTP, and bulk messages programmatically. Every request must be authenticated with an API key. All responses are JSON. 

## **Authentication** 

Pass your API key in every request header: 

```
X-API-Key: cast_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Keys begin with `cast_` followed by 64 hex characters. Keep keys secret — never expose them in client-side code or public repositories. 

**Sandbox keys** begin with `cast_test_` . Use these to test your integration without sending real SMS or consuming credits (see Sandbox Mode). 

## **Base URL & Versioning** 

All endpoints are available at two equivalent paths: 

||**Base path**|
|---|---|
|**Recommended (versioned)**|`https://api.cast.ph/api/v1/`|
|Legacy (unversioned)|`https://api.cast.ph/api/`|



Both paths hit the same handlers with identical behavior. New integrations should use the versioned path. 

## **Response Format** 

All responses are JSON with a `success` boolean. 

##### **Success:** 

```
{ "success": true, ... }
```

##### **Error:** 

```
{
  "success": false,
  "error": "human-readable description",
```

```
  "error_code": "MACHINE_READABLE_CODE"
}
```

Always use `error_code` for programmatic error handling — the `error` string may change across versions but `error_code` is stable. 

## **Sandbox Mode** 

Use a `cast_test_` sandbox key to test without real SMPP sends or credit deductions. 

- All 5 send endpoints return a realistic mock response immediately 

- No SMS is ever delivered to the carrier 

- No credits are consumed 

- Response includes `"sandbox": true` 

##### **Example sandbox response:** 

```
{
  "success": true,
  "message_id": "SANDBOX_a1b2c3d4e5f6a7b8",
  "parts": 1,
  "sandbox": true
}
```

Contact Cast to obtain a sandbox key for your account. 

## **Idempotency** 

All send endpoints support idempotent retries to prevent duplicate sends on network failures. 

Add the header to any send request: 

```
X-Idempotency-Key: <unique-request-id>
```

- Key must be 255 characters or fewer (UUID recommended) 

- On the **first** request with a given key: sends normally, caches the response for **24 hours** 

- On a **retry** with the same key: returns the original cached response — no duplicate send occurs. Response includes header `X-Idempotent-Replay: true` 

- Keys are scoped to your API key — different accounts can use the same key independently 

**Recommended pattern:** Generate a UUID per send attempt and store it alongside the pending request. On retry, reuse the same UUID. 

## **Endpoints** 

### **1. Send SMS** 

##### **`POST /api/v1/sms/send`** 

Sends a single SMS via the promotional channel. 

#### **_Headers_** 

|**Header**|**Required**|**Value**|
|---|---|---|
|`X-API-Key`|Yes|Your API key|
|`Content-Type`|Yes|`application/json`|
|`X-Idempotency-Key`|No|Unique request ID for safe<br>retries|



#### **_Request Body_** 

```
{
  "to": "09171234567",
  "message": "Hello from Cast!",
  "sender_id": "MYAPP",
  "scheduled_at": "2026-04-06T10:00:00Z"
```

```
}
```

|**Field**|**Type**|**Required**|**Description**|
|---|---|---|---|
|`to`|string|Yes|Recipient phone<br>number. 7–20 chars,<br>digits and`+()-`. Use<br>E.164 format<br>(`+639171234567`) or<br>local format<br>(`09171234567`).|
|`message`|string|Yes|Message text. Max<br>10,000 characters.<br>Long messages are<br>automatically split into<br>multi-part SMS.|
|`sender_id`|string|No|Approved sender ID to<br>display to recipient.<br>Max 20 chars. Defaults<br>to first approved sender<br>ID if omitted.|
|`scheduled_at`|ISO 8601 string|No|UTC timestamp for<br>future delivery. Must<br>be at least 30 seconds<br>in the future. Omit for<br>immediate send.|



#### **_Immediate Send — Response_** **_`200`_** 

```
{
  "success": true,
  "message_id": "CASTabc123def456",
  "parts": 1
}
```

|**Field**|**Description**|
|---|---|
|`message_id`|Use this to check delivery status. Starts with<br>`CAST`.|
|`parts`|SMS parts sent. Each part costs 1 credit.|



#### **_Scheduled Send — Response_** **_`202`_** 

```
{
  "success": true,
  "scheduled_at": "2026-04-06T10:00:00Z"
}
```

No `message_id` is returned for scheduled sends — it will be assigned when the message is dispatched. The backend polls every 30 seconds and sends due messages automatically. Credits are deducted at dispatch time, not at schedule time. 

### **2. Send Bulk SMS** 

##### **`POST /api/v1/sms/bulk`** 

Sends the same message to multiple recipients in one request. Up to **1,000 destinations** per call. Credits are reserved upfront for the full batch. Each destination is sent and logged individually, so partial success is possible. 

#### **_Request Body_** 

```
{
  "to": ["09171234567", "09181234567", "09191234567"],
  "message": "Hello everyone!",
  "sender_id": "MYAPP",
  "scheduled_at": "2026-04-06T10:00:00Z"
}
```

|**Field**|**Type**|**Required**|**Description**|
|---|---|---|---|
|`to`|array of strings|Yes|1–1,000 phone<br>numbers|
|`message`|string|Yes|Same message sent to<br>all recipients|
|`sender_id`|string|No|Defaults to first<br>approved sender ID|
|`scheduled_at`|ISO 8601 string|No|UTC timestamp for|



**Field Type Required Description** future delivery. Must be ≥30 seconds in the future. Each destination is queued as an individual scheduled message. Omit for immediate send. **_Response_** **_`200` (immediate)_** `{ "success": true, "total": 3, "sent": 3, "failed": 0, "results": [ { "to": "09171234567", "success": true, "message_id": "CASTabc...", "parts": 1 }, { "to": "09181234567", "success": true, "message_id": "CASTdef...", "parts": 1 }, { "to": "09191234567", "success": false, "error": "failed to send message" } ] }` 

#### **_Response_** **_`202` (scheduled)_** 

```
{
  "success": true,
  "scheduled": 3,
  "scheduled_at": "2026-04-06T10:00:00Z"
}
```

Top-level `success` is `true` only if all recipients succeeded (immediate) or all were queued (scheduled). For immediate sends, check `failed` and per-entry `success` to detect partial failures — credits for failed sends are automatically refunded. For scheduled sends, credits are deducted at dispatch time (every 30 seconds), not at the time of this request. 

The HTTP status is always `200` when the request itself is valid, even if some sends failed. Requestlevel errors (invalid input, insufficient credits) return `400` / `402` / `403` with no `results` array. 

### **3. Send OTP** 

##### **`POST /api/v1/otp/send`** 

Sends an OTP message via a dedicated, higher-priority SMPP pool. Use this for verification codes and time-sensitive authentication messages. 

Same request and response as Send SMS. `scheduled_at` is not supported. 

### **4. Send SIM** 

##### **`POST /api/v1/sim/send`** 

Sends via a SIM gateway. Same request and response as Send SMS. 

**Account requirement:** The `sim` channel must be explicitly enabled on your account. Accounts default to `sms` , `otp` , and `bulk` . Contact Cast to enable SIM access. 

### **5. Send Bulk SIM** 

##### **`POST /api/v1/sim/bulk`** 

Bulk send via the SIM gateway. Same request and response as Send Bulk SMS. 

**Account requirement:** Same as Send SIM. 

### **6. Get SIM Message Status** 

##### **`GET /api/v1/sim/status/{message_id}`** 

Returns the delivery status of a SIM message. Same response shape as Get Message Status. 

### **7. Send Viber** 

##### **`POST /api/v1/viber/send`** 

Sends a Viber message via the Messaggio channel. 

**Account requirement:** The `viber` channel must be explicitly enabled on your account. Contact Cast to enable Viber access. 

#### **_Request Body_** 

```
{
  "recipient": "+639171234567",
  "sender_code": "MYAPP",
  "label": "My App",
  "content": [
    { "type": "text", "text": "Hello from Cast!" }
  ],
  "options": {
    "ttl": 86400,
    "external_id": "your-ref-123"
  }
}
```

|**Field**|**Type**|**Required**|**Description**|
|---|---|---|---|
|`recipient`|string|Yes|Recipient phone<br>number in E.164<br>format (e.g.|



|**Field**|**Type**|**Required**|**Description**|
|---|---|---|---|
||||`+639171234567`)|
|`sender_code`|string|No|Viber sender code<br>assigned to your<br>account. Defaults to the<br>account's default<br>sender.|
|`label`|string|No|Display label for the<br>message. Defaults to<br>the sender's configured<br>label.|
|`content`|array|Yes|Messaggio content<br>array. At minimum one<br>element with<br>`{ "type":`<br>`"text", "text":`<br>`"..." }`.|
|`options.ttl`|integer|No|Message TTL in<br>seconds. Minimum 60.<br>Defaults to 86400<br>(24h).|
|`options.externa`<br>`l_id`|string|No|Your own reference ID,<br>passed to Messaggio<br>for DLR correlation.|



#### **_Response_** **_`200`_** 

```
{
  "success": true,
  "message_id": "cstvbr_abc123...",
  "recipient": "+639171234567",
  "credits_used": 1
}
```

Credits are refunded automatically if Messaggio rejects the recipient. 

### **8. Get Viber Message Status** 

##### **`GET /api/v1/viber/status/{message_id}`** 

Returns the current delivery status of a Viber message. Use the `message_id` returned by Send <u>Viber.</u> 

#### **_Response_** **_`200`_** 

```
{
  "success": true,
  "message_id": "cstvbr_abc123...",
  "status": "sent",
```

```
  "delivery_status": 70,
  "sent_at": "2026-05-20T08:30:11Z",
  "delivered_at": "2026-05-20T08:30:45Z"
}
```

##### **`delivery_status` values (Messaggio numeric codes):** 

|**Code**|**Meaning**|
|---|---|
|`70`|Delivered to handset|
|`91`|Recipient not on Viber|
|Other|See Messaggio documentation|



`delivery_status` and `delivered_at` are omitted until a DLR callback is received. 

### **9. Generate Unsubscribe Link** 

##### **`POST /api/v1/unsubscribe/token`** 

Generates a one-click unsubscribe link for a phone number and sender ID. Embed the returned link in SMS messages to let recipients opt out. When clicked, the number is permanently added to your account's unsubscribe list and future sends to that number from the same sender ID are automatically blocked. 

#### **_Request Body_** 

```
{
  "phone": "+639171234567",
  "sender_id": "MYAPP"
}
```

|**Field**|**Type**|**Required**|**Description**|
|---|---|---|---|
|`phone`|string|Yes|Recipient phone<br>number|
|`sender_id`|string|Yes|The sender ID this<br>unsubscribe applies to|



#### **_Response_** **_`200`_** 

```
{
  "success": true,
  "link": "u.cast.ph/Ab3Xy9Zq",
  "expires_at": "2026-06-02T08:30:00Z"
}
```

The link is HTTPS-enforced. Tokens expire after 7 days but are refreshed on each call for the same phone+sender_id pair. Returns `422` with `error_code: "ALREADY_UNSUBSCRIBED"` if the number has already opted out. 

### **10. List Unsubscribed Numbers** 

##### **`GET /api/v1/account/unsubscribed`** 

Returns all phone numbers that have opted out for your account, with the sender ID and timestamp of each unsubscribe. 

#### **_Response_** **_`200`_** 

```
{
  "success": true,
  "data": [
    {
      "phone": "+639171234567",
      "sender_id": "MYAPP",
      "unsubscribed_at": "2026-05-15T10:22:00Z",
      "ip": "1.2.3.4"
    }
  ]
}
```

`ip` is the IP address from which the unsubscribe was confirmed (may be `null` ). 

### **11. Get Balance** 

##### **`GET /api/v1/account/balance`** 

Returns the account's current credit balance. 

#### **_Response_** **_`200`_** 

```
{
  "success": true,
  "credits": 4750,
  "currency": "PHP"
}
```

`credits` is an integer (SMS parts, not pesos). Each part costs 1 credit. For postpaid accounts, credits go negative — the value represents outstanding usage debt. 

### **12. Get Profile** 

##### **`GET /api/v1/account/profile`** 

Returns the authenticated account's profile and configuration. 

#### **_Response_** **_`200`_** 

```
{
  "success": true,
  "id": 42,
  "name": "Acme Corp",
  "email": "billing@acme.ph",
  "mobile": "+639171234567",
  "username": "acme",
  "credits": 4750,
```

```
  "billing_type": "topup",
  "allowed_channels": ["sms", "otp", "bulk"],
  "is_active": true,
  "created_at": "2025-01-15T08:00:00Z"
}
```

|**Field**|**Description**|
|---|---|
|`billing_type`|`"topup"`(prepaid) or`"postpaid"`|
|`allowed_channels`|Which send endpoints your account can use|



### **13. Get Usage Stats** 

##### **`GET /api/v1/account/usage`** 

Returns message volume statistics for the account over a date range. Defaults to the last 30 days. 

#### **_Query Parameters_** 

|**Param**|**Type**|**Default**|**Description**|
|---|---|---|---|
|`from`|`YYYY-MM-DD`|30 days ago|Start date (inclusive)|
|`to`|`YYYY-MM-DD`|today|End date (inclusive)|



#### **_Response_** **_`200`_** 

```
{
  "success": true,
  "from": "2026-03-06",
  "to": "2026-04-05",
  "total": 1500,
  "total_sent": 1480,
  "total_failed": 20,
  "total_parts": 1620,
  "daily": [
    { "date": "2026-04-05", "total": 120, "sent": 118, "failed": 2, "parts": 130
},
    { "date": "2026-04-04", "total": 200, "sent": 198, "failed": 2, "parts": 215
}
  ]
}
```

`total_parts` is the actual SMS parts submitted to the carrier (what affects credit consumption for multi-part messages). `daily` is ordered newest first. 

### **14. Get Approved Sender IDs** 

##### **`GET /api/v1/account/sender-ids`** 

Returns the sender IDs approved for this account. 

**_Response_** **_`200`_** 

```
{
  "success": true,
  "sender_ids": [
    { "sender_id": "MYAPP", "label": "Main app sender", "channel": "sms" },
    { "sender_id": "VERIFY", "label": "OTP sender", "channel": "sms" },
    { "sender_id": "ESIM1", "label": "SIM gateway sender", "channel": "sim" }
  ]
}
```

Each entry includes a `channel` field — either `"sms"` or `"sim"` . Use this to route the send request to the correct endpoint: `"sms"` → `/api/v1/sms/send` , `"sim"` → `/api/v1/sim/send` . Pass `sender_id` values in send requests. If only one is configured, the `sender_id` field is optional in requests — the API uses it automatically. 

### **15. Get Message Logs** 

##### **`GET /api/v1/sms/logs`** 

Returns paginated message history for the account. Results are scoped to your account only. 

#### **_Query Parameters_** 

|**Param**|**Type**|**Default**|**Description**|
|---|---|---|---|
|`status`|string|all|Filter:`sent`or<br>`failed`|
|`search`|string|—|Search destination,<br>message text, message<br>ID, sender ID|
|`from`|`YYYY-MM-DD`|—|Start date (inclusive)|
|`to`|`YYYY-MM-DD`|—|End date (inclusive)|
|`limit`|integer|50|Max 500|
|`offset`|integer|0|For pagination|



#### **_Response_** **_`200`_** 

```
{
  "success": true,
  "count": 1,
  "logs": [
    {
      "id": 42413,
      "message_type": "sms",
      "sender_id": "MYAPP",
      "destination": "+639171234567",
      "message": "Hello!",
      "smpp_message_id": "CASTabc123...",
      "status": "sent",
      "parts": 1,
      "created_at": "2026-04-05T08:30:11Z",
      "dlr_status": "DELIVRD",
```

```
      "delivered_at": "2026-04-05T08:31:02Z"
    }
  ]
}
```

`dlr_status` and `delivered_at` are omitted until a delivery receipt arrives from the carrier. 

### **16. Get Message Status** 

##### **`GET /api/v1/sms/status/{message_id}`** 

Returns the current delivery status of a message. `{message_id}` is the value returned by send endpoints. 

#### **_Response_** **_`200`_** 

```
{
  "success": true,
  "message_id": "CASTabc123...",
  "status": "delivered",
  "sent_at": "2026-04-05T08:30:11Z",
  "dlr_status": "DELIVRD",
  "delivered_at": "2026-04-05T08:31:02Z"
}
```

##### **`status` values:** 

|**Value**|**Meaning**|
|---|---|
|`sent`|Submitted to carrier, awaiting delivery receipt|
|`failed`|SMPP submission failed (credits automatically<br>refunded)|
|`pending`|Carrier acknowledged receipt (`ACCEPTD`),<br>attempting delivery to handset|
|`delivered`|Handset confirmed receipt (`DELIVRD`)|
|`undelivered`|Carrier could not deliver (`UNDELIV`,`REJECTD`,<br>or`EXPIRED`)|



Delivery receipts (DLRs) arrive asynchronously — anywhere from seconds to several minutes after send. Polling immediately after send will return `status: "sent"` . Retry after a few seconds. 

**Optional fields** (only present when applicable): 

- `dlr_status` — raw carrier value ( `DELIVRD` , `ACCEPTD` , `UNDELIV` , etc.) 

- `delivered_at` — timestamp of handset confirmation 

- `error_message` — SMPP error detail if status is `failed` 

### **17. Request a New Sender ID** 

##### **`POST /api/v1/account/sender-ids/request`** 

Submits a request to add a new sender ID (requires Cast review — LOA workflow). 

#### **_Request Body_** 

```
{
```

```
  "sender_id": "MYAPP",
```

- `"company_name": "Acme Corp",` 

- `"reason": "Customer order notifications",` 

- `"designation": "CEO",` 

- `"name": "Juan dela Cruz",` 

```
  "company_address": "123 Ayala Ave, Makati City",
  "sample_message": "Your order #12345 has been shipped."
}
```

|**Field**|**Required**|**Description**|
|---|---|---|
|`sender_id`|Yes|Max 20 chars|
|`company_name`|Yes|Registered company name|
|`reason`|Yes|Intended use-case|
|`designation`,`name`,<br>`company_address`,<br>`sample_message`|No|Recommended for faster<br>approval|



#### **_Response_** **_`200`_** 

```
{
  "success": true,
  "request_id": 17,
  "status": "pending_review",
  "message": "Your sender ID request has been submitted and is pending review."
}
```

### **18. Request Sender ID Deletion** 

##### **`POST /api/v1/account/sender-ids/delete-request`** 

Submits a request to remove an existing sender ID from the account. 

#### **_Request Body_** 

```
{
  "sender_id": "OLDAPP",
  "reason": "Rebranding — sender ID no longer in use"
}
```

#### **_Response_** **_`200`_** 

```
{
  "success": true,
  "request_id": 18,
```

```
  "status": "pending_review",
```

```
  "message": "Your sender ID deletion request has been submitted and is pending
review."
}
```

## **Error Handling** 

All error responses include both `error` (human-readable) and `error_code` (stable constant for programmatic use). 

```
{
  "success": false,
  "error": "insufficient credits: need 2",
  "error_code": "INSUFFICIENT_CREDITS"
}
```

### **Error Code Reference** 

|**HTTP Status**|**`error_code`**|**Cause**|
|---|---|---|
|`400`|`INVALID_REQUEST`|Malformed JSON body|
|`400`|`VALIDATION_ERROR`|Invalid field value (bad phone<br>number, missing required field,<br>`scheduled_at`in the past,<br>etc.)|
|`401`|`INVALID_API_KEY`|Missing or invalid`X-API-`<br>`Key`|
|`402`|`INSUFFICIENT_CREDITS`|Not enough credits (topup<br>accounts)|
|`402`|`CREDIT_LIMIT_REACHED`|Postpaid usage exceeded<br>account credit limit|
|`403`|`API_KEY_REVOKED`|Key has been deactivated|
|`403`|`API_KEY_EXPIRED`|Key has passed its expiry date|
|`403`|`USER_INACTIVE`|Account has been disabled|
|`403`|`IP_NOT_WHITELISTED`|Request IP not in the account's<br>IP whitelist|
|`403`|`CHANNEL_NOT_ALLOWED`|Account does not have access<br>to this channel (e.g. SIM,<br>Viber)|
|`422`|`ALREADY_UNSUBSCRIBED`|Phone number is already on the<br>unsubscribe list for that sender<br>ID|
|`404`|`NOT_FOUND`|Message ID not found or<br>belongs to a different account|
|`405`|`METHOD_NOT_ALLOWED`|Wrong HTTP method|
|`429`|`RATE_LIMIT_EXCEEDED`|Rate limit exceeded (seeRate|



|**HTTP Status**|**`error_code`**|**Cause**|
|---|---|---|
|||Limits<br>)|
|`500`|`INTERNAL_ERROR`|Unexpected server-side error|
|`502`|`PROVIDER_ERROR`|Upstream provider (e.g.<br>Messaggio) rejected or failed<br>the request|
|`503`|`SERVICE_UNAVAILABLE`|SMPP pool or Viber channel is<br>disabled or not connected|



## **Rate Limits** 

Two layers of rate limiting apply: 

**Per-IP global limit:** 30 requests/second (burst of 50) — shared across all requests from the same IP address. 

**Per-account message rate:** Default 10 messages/second. Your account may have a custom rate limit configured. This applies to send endpoints only. 

On `429` , check the `Retry-After` response header and wait that many seconds before retrying. Implement exponential backoff for resilience. 

## **SMS Parts & Credits** 

Messages are automatically split into multiple parts based on character count and encoding: 

|**Encoding**|**Single SMS**|**Per part (multi-part)**|
|---|---|---|
|GSM-7 (standard Latin<br>characters)|160 chars|153 chars|
|Unicode (special characters,<br>emoji, non-Latin scripts)|70 chars|67 chars|



**1 credit = 1 SMS part.** A 200-character standard message uses 2 parts (2 credits). Check the `parts` field in the send response to see exactly how many credits were consumed. 

## **IP Whitelisting** 

If IP whitelisting is configured on your account, only requests from approved IPs or CIDR ranges are accepted. Unlisted IPs receive `403 Forbidden` with `error_code: "IP_NOT_WHITELISTED"` . 

Contact Cast to add or update your whitelisted IPs. 

## **Sender IDs** 

A Sender ID is the name or number shown to the recipient as the SMS sender (e.g. `MYAPP` , `VERIFY` , `+639171234567` ). 

- Sender IDs must be **pre-approved** before use. 

- If your account has only one Sender ID, you can omit `sender_id` from requests — it defaults automatically. 

- If your account has multiple Sender IDs, specify `sender_id` in each request. 

- To register a new Sender ID, use the Request a New Sender ID endpoint. 

## **Code Examples** 

### **cURL — Single SMS** 

```
curl -X POST https://api.cast.ph/api/v1/sms/send \
  -H "X-API-Key: cast_your_api_key_here" \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: $(uuidgen)" \
  -d '{
    "to": "09171234567",
    "message": "Your verification code is 123456.",
    "sender_id": "MYAPP"
  }'
```

### **cURL — Bulk SMS** 

```
curl -X POST https://api.cast.ph/api/v1/sms/bulk \
  -H "X-API-Key: cast_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "to": ["09171234567", "09181234567"],
    "message": "Hello from Cast!",
    "sender_id": "MYAPP"
  }'
```

### **JavaScript (fetch)** 

```
const response = await fetch("https://api.cast.ph/api/v1/sms/send", {
  method: "POST",
  headers: {
    "X-API-Key": "cast_your_api_key_here",
    "Content-Type": "application/json",
    "X-Idempotency-Key": crypto.randomUUID(),
  },
  body: JSON.stringify({
    to: "639171234567",
    message: "Your verification code is 123456.",
    sender_id: "MYAPP",
  }),
});
```

```
const data = await response.json();
if (data.success) {
  console.log("Sent! Message ID:", data.message_id, "Parts:", data.parts);
} else {
  console.error(`Error [${data.error_code}]:`, data.error);
}
```

### **Python (requests)** 

```
import requests
import uuid
response = requests.post(
    "https://api.cast.ph/api/v1/sms/send",
    headers={
        "X-API-Key": "cast_your_api_key_here",
        "Content-Type": "application/json",
        "X-Idempotency-Key": str(uuid.uuid4()),
    },
    json={
        "to": "09171234567",
        "message": "Your verification code is 123456.",
        "sender_id": "MYAPP",
    },
)
data = response.json()
if data["success"]:
    print(f"Sent! Message ID: {data['message_id']}, Parts: {data['parts']}")
else:
    print(f"Error [{data['error_code']}]: {data['error']}")
```

### **PHP (cURL)** 

```
<?php
$apiKey = "cast_your_api_key_here";
$idempotencyKey = bin2hex(random_bytes(16));
$payload = json_encode([
    "to"        => "639171234567",
    "message"   => "Your verification code is 123456.",
    "sender_id" => "MYAPP",
]);
$ch = curl_init("https://api.cast.ph/api/v1/sms/send");
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "X-API-Key: $apiKey",
    "Content-Type: application/json",
    "X-Idempotency-Key: $idempotencyKey",
]);
$response = json_decode(curl_exec($ch), true);
curl_close($ch);
if ($response["success"]) {
```

```
    echo "Sent! Message ID: " . $response["message_id"] . "\n";
} else {
    echo "Error [{$response['error_code']}]: {$response['error']}\n";
}
```

### **C# (HttpClient)** 

```
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
var client = new HttpClient();
client.DefaultRequestHeaders.Add("X-API-Key", "cast_your_api_key_here");
client.DefaultRequestHeaders.Add("X-Idempotency-Key",
Guid.NewGuid().ToString());
var payload = JsonSerializer.Serialize(new
{
    to = "09171234567",
    message = "Your verification code is 123456.",
    sender_id = "MYAPP"
});
var content = new StringContent(payload, Encoding.UTF8, "application/json");
var response = await client.PostAsync("https://api.cast.ph/api/v1/sms/send",
content);
var body = await response.Content.ReadAsStringAsync();
using var doc = JsonDocument.Parse(body);
var root = doc.RootElement;
if (root.GetProperty("success").GetBoolean())
{
    Console.WriteLine($"Sent! Message ID:
{root.GetProperty("message_id").GetString()}, Parts:
{root.GetProperty("parts").GetInt32()}");
}
else
{
    Console.WriteLine($"Error [{root.GetProperty("error_code").GetString()}]:
{root.GetProperty("error").GetString()}");
}
```

## **Support** 

For API access, sender ID registration, IP whitelisting, sandbox keys, or technical issues, contact the Cast team. 

