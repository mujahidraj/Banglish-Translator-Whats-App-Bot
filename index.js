require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

const { PORT, WHATSAPP_TOKEN, PHONE_NUMBER_ID, VERIFY_TOKEN, GEMINI_API_KEY } = process.env;

// Initialize Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// 1. Webhook Verification (Required by Meta to link your server)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// 2. Receive Incoming WhatsApp Messages
app.post('/webhook', async (req, res) => {
    // Acknowledge receipt immediately so Meta doesn't retry sending the same message
    res.sendStatus(200);

    const body = req.body;
    if (body.object && body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
        const message = body.entry[0].changes[0].value.messages[0];
        const senderPhone = message.from; 
        
        // Process only text messages
        if (message.type === 'text') {
            const banglishText = message.text.body;
            console.log(`Received Banglish: ${banglishText}`);
            await translateAndReply(banglishText, senderPhone);
        }
    }
});

// 3. Translate with Gemini and Send Reply via Meta Graph API
async function translateAndReply(banglishText, recipientPhone) {
    const prompt = `You are a translator. The following text is in "Banglish". Translate it to English and standard Bengali script (Bangla). Format exactly like this without any extra chat:
🇬🇧 English: [translation]
🇧🇩 Bangla: [translation]

Text: "${banglishText}"`;

    try {
        const result = await model.generateContent(prompt);
        const translation = result.response.text().trim();

        // Send the POST request to Meta's API to deliver the message
        await axios.post(
            `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: 'whatsapp',
                to: recipientPhone,
                type: 'text',
                text: { body: translation }
            },
            {
                headers: {
                    'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log('✅ Translation sent successfully.');
    } catch (error) {
        console.error('❌ API Error:', error.response ? error.response.data : error.message);
    }
}

app.listen(PORT, () => {
    console.log(`🚀 Banglish Bot Server running on port ${PORT}`);
});