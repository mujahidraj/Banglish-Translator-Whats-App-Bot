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

// --- IN-MEMORY DATABASE ---
// This temporarily stores user language preferences. 
// Default is English and Bangla.
const userLanguages = {}; 
const DEFAULT_LANGS = "English and Bangla";

// 1. Webhook Verification
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
    // Acknowledge receipt immediately
    res.sendStatus(200);

    const body = req.body;
    if (body.object && body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
        const message = body.entry[0].changes[0].value.messages[0];
        const senderPhone = message.from; 
        
        // Check what languages this specific user wants
        const targetLangs = userLanguages[senderPhone] || DEFAULT_LANGS;

        try {
            if (message.type === 'text') {
                const textBody = message.text.body;
                
                // Handle the /lang command
                if (textBody.toLowerCase().startsWith('/lang ')) {
                    const newLangs = textBody.replace('/lang ', '').trim();
                    userLanguages[senderPhone] = newLangs;
                    await sendMessage(senderPhone, `✅ Language updated! I will now translate to: ${newLangs}. Send me text or voice!`);
                    return;
                }

                console.log(`Received Text: ${textBody}`);
                await processText(textBody, targetLangs, senderPhone);

            } else if (message.type === 'audio') {
                console.log(`Received Audio ID: ${message.audio.id}`);
                await sendMessage(senderPhone, "🎧 Listening and translating...");
                await processAudio(message.audio.id, targetLangs, senderPhone);
            }
        } catch (error) {
            console.error('❌ Error processing message:', error);
            await sendMessage(senderPhone, "⚠️ Sorry, I ran into an error processing that.");
        }
    }
});

// --- HELPER FUNCTIONS ---

// Process Standard Text
async function processText(text, targetLangs, recipientPhone) {
    const prompt = `You are a translator. Translate the following text into these languages: ${targetLangs}. 
    Format your response cleanly with the language name or flag first. Do not add extra chat.
    Text: "${text}"`;

    const result = await model.generateContent(prompt);
    await sendMessage(recipientPhone, result.response.text().trim());
}

// Download Audio from Meta and Process with Gemini
async function processAudio(mediaId, targetLangs, recipientPhone) {
    // 1. Ask Meta for the media URL
    const mediaRes = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
        headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
    });
    const mediaUrl = mediaRes.data.url;

    // 2. Download the actual audio file buffer
    const audioRes = await axios.get(mediaUrl, {
        headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
        responseType: 'arraybuffer'
    });
    
    // 3. Convert to Base64 for Gemini
    const base64Audio = Buffer.from(audioRes.data).toString('base64');

    // 4. Send audio + prompt to Gemini
    const prompt = `You are a translator. Listen to this audio carefully. First, write down the original transcript. Then, translate it into these languages: ${targetLangs}. 
    Format like this:
    🎙️ Transcript: [what they said]
    🌍 Translations:
    [Language 1]: [translation]
    [Language 2]: [translation]`;

    const result = await model.generateContent([
        prompt,
        { inlineData: { data: base64Audio, mimeType: 'audio/ogg' } }
    ]);

    await sendMessage(recipientPhone, result.response.text().trim());
}

// Unified Send Message Function
async function sendMessage(recipientPhone, text) {
    await axios.post(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
        {
            messaging_product: 'whatsapp',
            to: recipientPhone,
            type: 'text',
            text: { body: text }
        },
        {
            headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            }
        }
    );
    console.log('✅ Reply sent.');
}

// Keep-alive ping route
app.get('/', (req, res) => {
    res.send('✅ Banglish Bot is awake and listening!');
});

app.listen(PORT, () => {
    console.log(`🚀 Banglish Bot Server running on port ${PORT}`);
});