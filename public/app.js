// --- State ---
let sessionId = null;
let isProcessing = false;
const messagesEl = document.getElementById('messages');
const promptInput = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');
const statusEl = document.getElementById('status');

// --- API helpers ---
const API_BASE = '/api';

async function apiCall(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(`${API_BASE}${endpoint}`, options);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

// --- UI ---
function setStatus(connected) {
    statusEl.textContent = connected ? '🟢 Connected' : '⚪ Disconnected';
    statusEl.className = connected ? 'connected' : 'disconnected';
}

function addMessage(role, content) {
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.innerHTML = `<div class="role">${role === 'user' ? 'You' : 'Assistant'}</div><div class="content">${escapeHtml(content)}</div>`;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showTyping() {
    const div = document.createElement('div');
    div.className = 'message assistant';
    div.id = 'typing-indicator';
    div.innerHTML = '<div class="role">Assistant</div><div class="typing-indicator"><span></span><span></span><span></span></div>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function removeTyping() {
    const el = document.getElementById('typing-indicator');
    if (el) el.remove();
}

// --- Core logic ---
async function initSession() {
    try {
        const data = await apiCall('/session/create', 'POST', {});
        sessionId = data.sessionId;
        setStatus(true);
        addMessage('assistant', 'Session ready. How can I help you today?');
    } catch (err) {
        console.error('Session init error:', err);
        setStatus(false);
        addMessage('assistant', '❌ Could not connect to gateway. Please ensure the gateway is running on port 8080.');
    }
}

async function sendPrompt(prompt) {
    if (isProcessing || !sessionId || !prompt.trim()) return;

    isProcessing = true;
    sendBtn.disabled = true;
    promptInput.disabled = true;

    addMessage('user', prompt.trim());
    promptInput.value = '';
    showTyping();

    try {
        const data = await apiCall(`/session/${sessionId}/chat`, 'POST', { prompt: prompt.trim() });
        removeTyping();
        // The gateway returns the assistant's response in data.response or data.reply
        const reply = data.text || 'No response text received.';
        addMessage('assistant', reply);
    } catch (err) {
        removeTyping();
        console.error('Chat error:', err);
        addMessage('assistant', `❌ Error: ${err.message}`);
    } finally {
        isProcessing = false;
        sendBtn.disabled = false;
        promptInput.disabled = false;
        promptInput.focus();
    }
}

// --- Event listeners ---
sendBtn.addEventListener('click', () => sendPrompt(promptInput.value));
promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendPrompt(promptInput.value);
    }
});

// --- Start ---
initSession();
