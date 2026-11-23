import fs from 'node:fs';
import path from 'node:path';

export function formatPrice(px) {
  const n = Number(px || 0);
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 1 })}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export function buildSmartReplies(messageText, linkedMarket) {
  const lower = String(messageText || '').toLowerCase();
  const replies = [];

  if (linkedMarket) {
    const sign = linkedMarket.change24hPct >= 0 ? '+' : '';
    replies.push(`Seeing ${linkedMarket.symbol} at ${formatPrice(linkedMarket.markPx)} (${sign}${linkedMarket.change24hPct}%)`);
  } else {
    replies.push('Got it, checking chart now');
  }

  if (lower.includes('short') || lower.includes('sell') || lower.includes('bear') || lower.includes('bos')) {
    replies.push('Watching structure break, short level ready');
  } else if (lower.includes('long') || lower.includes('buy') || lower.includes('bull')) {
    replies.push('Seeing strength, tracking entry level');
  } else {
    replies.push('In a session right now, watching on glasses');
  }

  replies.push('Moving stop to BE, will update soon');
  return replies.slice(0, 3);
}

export class TelegramService {
  constructor({ token, defaultChatId = '', storagePath = '' }) {
    this.token = String(token || '').trim();
    this.defaultChatId = String(defaultChatId || '').trim();
    this.storagePath = storagePath;
    this.botInfo = null;
    this.lastUpdateId = 0;
    this.messages = [];
    this.activeChatId = this.defaultChatId;
    this.activeChatTitle = '';
    this.lastError = null;
    this.load();
  }

  get configured() {
    return Boolean(this.token && !this.token.includes('REPLACE_WITH'));
  }

  load() {
    if (!this.storagePath || !fs.existsSync(this.storagePath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
      if (typeof data.lastUpdateId === 'number') this.lastUpdateId = data.lastUpdateId;
      if (Array.isArray(data.messages)) this.messages = data.messages.slice(0, 30);
      if (data.activeChatId && !this.activeChatId) this.activeChatId = String(data.activeChatId);
      if (data.activeChatTitle) this.activeChatTitle = String(data.activeChatTitle);
    } catch {
      // Ignore corrupt cache
    }
  }

  save() {
    if (!this.storagePath) return;
    fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
    fs.writeFileSync(
      this.storagePath,
      JSON.stringify(
        {
          lastUpdateId: this.lastUpdateId,
          activeChatId: this.activeChatId,
          activeChatTitle: this.activeChatTitle,
          messages: this.messages.slice(0, 30),
        },
        null,
        2
      ),
      'utf8'
    );
  }

  async _call(method, body = null) {
    if (!this.configured) throw new Error('TELEGRAM_BOT_TOKEN not configured in .env');
    const url = `https://api.telegram.org/bot${this.token}/${method}`;
    const opts = body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        }
      : { method: 'GET', signal: AbortSignal.timeout(10000) };

    const resp = await fetch(url, opts);
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.description || `Telegram API HTTP ${resp.status}`);
    return data.result;
  }

  async verifyBot() {
    if (!this.configured) return null;
    try {
      this.botInfo = await this._call('getMe');
      this.lastError = null;
      return this.botInfo;
    } catch (err) {
      this.lastError = String(err?.message || err);
      return null;
    }
  }

  async pollUpdates() {
    if (!this.configured) {
      return { connected: false, messages: this.messages, activeChatId: this.activeChatId };
    }
    try {
      const offset = this.lastUpdateId ? this.lastUpdateId + 1 : undefined;
      const updates = await this._call('getUpdates', {
        offset,
        limit: 30,
        timeout: 0,
        allowed_updates: ['message', 'channel_post', 'edited_message'],
      });

      let changed = false;
      for (const upd of updates) {
        if (upd.update_id > this.lastUpdateId) {
          this.lastUpdateId = upd.update_id;
          changed = true;
        }
        const msg = upd.message || upd.channel_post || upd.edited_message;
        if (!msg) continue;
        const text = msg.text || msg.caption || '';
        if (!text.trim()) continue;

        const chatId = String(msg.chat?.id || '');
        const chatTitle = msg.chat?.title || msg.chat?.username || 'Telegram';
        if (chatId) {
          this.activeChatId = chatId;
          this.activeChatTitle = chatTitle;
        }

        const sender = msg.from?.username
          ? `@${msg.from.username}`
          : [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || chatTitle;

        const normalized = {
          id: `${chatId}:${msg.message_id}`,
          messageId: msg.message_id,
          chatId,
          chatTitle,
          sender,
          text: text.trim(),
          timestamp: (msg.date || Math.floor(Date.now() / 1000)) * 1000,
          direction: 'IN',
        };

        const idx = this.messages.findIndex((m) => m.id === normalized.id);
        if (idx >= 0) this.messages[idx] = normalized;
        else this.messages.unshift(normalized);
        changed = true;
      }

      this.messages.sort((a, b) => b.timestamp - a.timestamp);
      this.messages = this.messages.slice(0, 30);
      if (changed) this.save();
      this.lastError = null;
    } catch (err) {
      this.lastError = String(err?.message || err);
    }

    return {
      connected: Boolean(this.botInfo || !this.lastError),
      botUsername: this.botInfo?.username || '',
      activeChatId: this.activeChatId,
      activeChatTitle: this.activeChatTitle,
      messages: this.messages,
      lastError: this.lastError,
    };
  }

  async sendMessage({ chatId, text, replyToMessageId }) {
    const targetChat = String(chatId || this.activeChatId || '').trim();
    if (!targetChat) throw new Error('No Telegram chat discovered yet.');
    const cleanText = String(text || '').trim();
    if (!cleanText) throw new Error('Message text cannot be empty');

    const payload = { chat_id: targetChat, text: cleanText };
    if (replyToMessageId) payload.reply_to_message_id = Number(replyToMessageId);

    const sent = await this._call('sendMessage', payload);
    const outgoing = {
      id: `${targetChat}:${sent.message_id}`,
      messageId: sent.message_id,
      chatId: targetChat,
      chatTitle: this.activeChatTitle || 'Telegram',
      sender: this.botInfo?.username ? `@${this.botInfo.username}` : 'GlanceDesk',
      text: cleanText,
      timestamp: (sent.date || Math.floor(Date.now() / 1000)) * 1000,
      direction: 'OUT',
    };
    this.messages.unshift(outgoing);
    this.messages = this.messages.slice(0, 30);
    this.save();
    return outgoing;
  }
}
