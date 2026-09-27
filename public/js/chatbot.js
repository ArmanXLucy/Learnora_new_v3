function toggleChatbot() {
  const panel = document.getElementById('chatbot-panel');
  panel.classList.toggle('open');
}

function getCurrentTopicFromUrl() {
  const match = window.location.pathname.match(/\/topic\/([a-z0-9_]+)/i);
  return match ? match[1] : null;
}

async function sendChatMessage() {
  const input = document.getElementById('chatbot-input');
  const message = input.value.trim();
  if (!message) return;
  const messages = document.getElementById('chatbot-messages');

  messages.innerHTML += `<div class="chat-msg user">${escapeHtml(message)}</div>`;
  input.value = '';
  messages.scrollTop = messages.scrollHeight;

  try {
    const res = await fetch('/api/chatbot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, topic: getCurrentTopicFromUrl() })
    });
    const data = await res.json();
    messages.innerHTML += `<div class="chat-msg bot">${escapeHtml(data.reply)}</div>`;
  } catch (err) {
    messages.innerHTML += `<div class="chat-msg bot">Sorry, something went wrong. Please try again.</div>`;
  }
  messages.scrollTop = messages.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
