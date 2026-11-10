const Chat = {
  currentFlinkNumber: null,
  messages: [],

  async init() {
    this.messages = await Storage.getAll('messages');
    this.renderChatsList();
  },

  renderChatsList() {
    const el = document.getElementById('chats-list');
    const chatMap = new Map();

    this.messages.filter(m => !m.groupId).forEach(m => {
      const other = m.from === Auth.getProfile().flinkNumber ? m.to : m.from;
      if (!chatMap.has(other) || m.time > chatMap.get(other).time) {
        chatMap.set(other, m);
      }
    });

    if (!chatMap.size) {
      el.innerHTML = '<div class="empty-state"><svg><use href="#icon-chat"/></svg><h3>No chats yet</h3><p>Start a conversation from Contacts or Dialpad</p></div>';
      return;
    }

    const sorted = Array.from(chatMap.entries()).sort((a, b) => b[1].time - a[1].time);
    el.innerHTML = '<div class="list">' + sorted.map(([flinkNumber, lastMsg]) => {
      const name = Contacts.getName(flinkNumber);
      const subtitle = lastMsg.type === 'text' ? lastMsg.content : lastMsg.type === 'image' ? 'Photo' : lastMsg.type === 'video' ? 'Video' : lastMsg.type === 'audio' ? 'Voice note' : 'File';
      const unread = this.messages.filter(m => m.from === flinkNumber && m.to === Auth.getProfile().flinkNumber && !m.read).length;
      return `
      <div class="list-item" onclick="Chat.open('${flinkNumber}')">
        <div class="list-item-avatar">${Utils.getInitials(name)}<div class="status-dot ${API.isConnected ? 'online' : 'offline'}"></div></div>
        <div class="list-item-info">
          <div class="list-item-title">${Utils.escapeHtml(name)}</div>
          <div class="list-item-subtitle">${Utils.escapeHtml(subtitle)}</div>
        </div>
        <div class="list-item-meta">
          <div class="list-item-time">${Utils.formatTime(lastMsg.time)}</div>
          ${unread ? `<div class="list-item-badge">${unread}</div>` : ''}
        </div>
      </div>
    `}).join('') + '</div>';
  },

  open(flinkNumber) {
    this.currentFlinkNumber = flinkNumber;
    const name = Contacts.getName(flinkNumber);
    document.getElementById('chat-name').textContent = name;
    document.getElementById('chat-avatar').textContent = Utils.getInitials(name);
    document.getElementById('chat-status').textContent = 'online';
    document.getElementById('chat-messages').innerHTML = '';
    UI.showScreen('chat');
    this.loadMessages(flinkNumber);
    this.markRead(flinkNumber);
  },

  async loadMessages(flinkNumber) {
    const myFlinkNumber = Auth.getProfile().flinkNumber;
    const msgs = this.messages.filter(m => !m.groupId && ((m.from === myFlinkNumber && m.to === flinkNumber) || (m.from === flinkNumber && m.to === myFlinkNumber))).sort((a, b) => a.time - b.time);
    msgs.forEach(m => this.renderMessage(m));
    this.scrollToBottom();
  },

  renderMessage(msg) {
    const el = document.getElementById('chat-messages');
    const isMe = msg.from === Auth.getProfile().flinkNumber;
    const html = this.buildMessageHTML(msg, isMe);
    el.insertAdjacentHTML('beforeend', html);
    this.scrollToBottom();
  },

  buildMessageHTML(msg, isMe) {
    let content = '';
    if (msg.type === 'text') content = `<div>${Utils.escapeHtml(msg.content)}</div>`;
    else if (msg.type === 'image') content = `<img src="${msg.content}" class="message-media" onclick="Media.openViewer('${msg.content}','image')">`;
    else if (msg.type === 'video') content = `<video src="${msg.content}" class="message-media" controls onclick="event.stopPropagation()" playsinline></video>`;
    else if (msg.type === 'audio') content = `<div class="message-audio" onclick="Media.playAudio(this,'${msg.content}')"><svg><use href="#icon-play"/></svg><div class="message-audio-bar"></div><span style="font-size:12px;">Voice</span></div>`;
    else if (msg.type === 'file') content = `<div class="message-file"><div class="message-file-icon"><svg><use href="#icon-file"/></svg></div><div class="message-file-info"><div class="message-file-name">${Utils.escapeHtml(msg.fileName || 'File')}</div><div class="message-file-size">${msg.fileSize || ''}</div></div></div>`;
    else if (msg.type === 'sticker') content = `<div style="font-size:48px;text-align:center;">${msg.content}</div>`;

    return `
      <div class="message ${isMe ? 'sent' : 'received'}">
        ${content}
        <div class="message-time">${Utils.formatTime(msg.time)}</div>
      </div>
    `;
  },

  scrollToBottom() {
    const el = document.getElementById('chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  },

  handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendText();
    }
  },

  async sendText() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text || !this.currentFlinkNumber) return;
    input.value = '';

    const myFlinkNumber = Auth.getProfile().flinkNumber;
    const msg = {
      id: Utils.generateId(),
      from: myFlinkNumber,
      to: this.currentFlinkNumber,
      type: 'text',
      content: text,
      time: Date.now(),
      read: true
    };

    if (!Calls.sendData({ kind: 'chat', message: msg })) {
      input.value = text;
      return;
    }
    await Storage.set('messages', msg);
    this.messages.push(msg);
    this.renderMessage(msg);
    this.renderChatsList();
  },

  async sendMedia(type, content, extra = {}) {
    if (!this.currentFlinkNumber) return;
    const myFlinkNumber = Auth.getProfile().flinkNumber;
    const msg = {
      id: Utils.generateId(),
      from: myFlinkNumber,
      to: this.currentFlinkNumber,
      type,
      content,
      time: Date.now(),
      read: true,
      ...extra
    };
    if (!Calls.sendData({ kind: 'chat', message: msg })) return;
    await Storage.set('messages', msg);
    this.messages.push(msg);
    this.renderMessage(msg);
    this.renderChatsList();
  },

  async receiveMessage(msg) {
    const payload = msg.payload || msg;
    if (payload.groupId) {
      Groups.receiveMessage(msg);
      return;
    }

    const m = {
      id: payload.id || Utils.generateId(),
      from: msg.from,
      to: Auth.getProfile().flinkNumber,
      type: payload.type || 'text',
      content: payload.content,
      time: payload.time || Date.now(),
      read: false,
      fileName: payload.fileName,
      fileSize: payload.fileSize
    };

    await Storage.set('messages', m);
    this.messages.push(m);

    if (this.currentFlinkNumber === m.from) {
      this.renderMessage(m);
      this.markRead(m.from);
    } else {
      this.renderChatsList();
      UI.toast(`Message from ${Contacts.getName(m.from)}`);
    }
  },

  async markRead(flinkNumber) {
    const myFlinkNumber = Auth.getProfile().flinkNumber;
    const unread = this.messages.filter(m => m.from === flinkNumber && m.to === myFlinkNumber && !m.read);
    for (const m of unread) {
      m.read = true;
      await Storage.set('messages', m);
    }
    this.renderChatsList();
  },

  search(query) {
    const q = query.toLowerCase();
    const items = document.querySelectorAll('#chats-list .list-item');
    items.forEach(item => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(q) ? 'flex' : 'none';
    });
  },

  openFromProfile() {
    if (Contacts.currentFlinkNumber) this.open(Contacts.currentFlinkNumber);
  }
};
