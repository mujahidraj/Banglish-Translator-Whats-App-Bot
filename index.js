require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Groq = require('groq-sdk'); // Swapped Gemini for Groq

const app = express();
app.use(express.json());

// Note: You need a GROQ_API_KEY in your .env now instead of GEMINI_API_KEY
const { PORT, WHATSAPP_TOKEN, PHONE_NUMBER_ID, VERIFY_TOKEN, GROQ_API_KEY } = process.env;

// Initialize Groq
const groq = new Groq({ apiKey: GROQ_API_KEY });

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
    res.sendStatus(200);

    const body = req.body;
    if (body.object && body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
        const message = body.entry[0].changes[0].value.messages[0];
        const senderPhone = message.from; 
        const targetLangs = userLanguages[senderPhone] || DEFAULT_LANGS;

        try {
            if (message.type === 'text') {
                const textBody = message.text.body;
                
                if (textBody.toLowerCase().startsWith('/lang ')) {
                    const newLangs = textBody.replace('/lang ', '').trim();
                    userLanguages[senderPhone] = newLangs;
                    await sendMessage(senderPhone, `✅ Language updated! I will now translate to: ${newLangs}.`);
                    return;
                }

                console.log(`Received Text: ${textBody}`);
                await processText(textBody, targetLangs, senderPhone);

            } else if (message.type === 'audio') {
                console.log(`Received Audio ID: ${message.audio.id}`);
                await sendMessage(senderPhone, "🎧 Listening and translating (via Llama 3.3)...");
                await processAudio(message.audio.id, targetLangs, senderPhone);
            }
        } catch (error) {
            console.error('❌ Error processing message:', error);
            await sendMessage(senderPhone, "⚠️ Sorry, I ran into an error processing that.");
        }
    }
});

// --- HELPER FUNCTIONS ---

// Process Text using Llama-3.3-70b-versatile
async function processText(text, targetLangs, recipientPhone) {
    const prompt = `You are an expert translator. Translate the following text into these languages: ${targetLangs}. 
    Format your response cleanly with the language name or flag first. Do not add extra chat or explanations.
    Text: "${text}"`;

    const chatCompletion = await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.3, // Keeps translations highly accurate and less "creative"
    });

    await sendMessage(recipientPhone, chatCompletion.choices[0].message.content.trim());
}

// Process Audio (Whisper -> Llama 3.3)
async function processAudio(mediaId, targetLangs, recipientPhone) {
    // 1. Get Meta URL
    const mediaRes = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
        headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
    });
    
    // 2. Download audio stream to a temporary file (Whisper requires a real file, not just base64)
    const tempFilePath = path.join(os.tmpdir(), `audio_${Date.now()}.ogg`);
    const audioRes = await axios.get(mediaRes.data.url, {
        headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
        responseType: 'stream'
    });
    
    const writer = fs.createWriteStream(tempFilePath);
    audioRes.data.pipe(writer);

    await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });

    // 3. Transcribe audio to text using Whisper
    const transcription = await groq.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: 'whisper-large-v3',
    });
    
    const transcriptText = transcription.text;

    // Clean up the temp file so your server doesn't run out of storage
    fs.unlinkSync(tempFilePath);

    // 4. Translate the transcript using Llama 3.3
    const prompt = `You are an expert translator. 
    Here is a transcript of what the user just said: "${transcriptText}"
    
    Format your reply exactly like this:
    🎙️ Transcript: ${transcriptText}
    🌍 Translations:
    [Translate to ${targetLangs} formatted cleanly]`;

    const chatCompletion = await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.3,
    });

    await sendMessage(recipientPhone, chatCompletion.choices[0].message.content.trim());
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

app.get('/', (req, res) => res.send('✅ Banglish Bot (Llama Edition) is awake!'));
app.listen(PORT, () => console.log(`🚀 Banglish Bot Server running on port ${PORT}`));