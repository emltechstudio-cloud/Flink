const Groups = {
  list: [],
  currentId: null,

  async init() {
    this.list = await Storage.getAll('groups');
    this.render();
  },

  render() {
    const el = document.getElementById('groups-list');
    if (!this.list.length) {
      el.innerHTML = '<div class="empty-state"><svg><use href="#icon-groups"/></svg><h3>No groups</h3><p>Create a group to start group chats and calls</p></div>';
      return;
    }
    el.innerHTML = '<div class="list">' + this.list.map(g => {
      const lastMsg = g.lastMessage ? `<div class="list-item-subtitle">${Utils.escapeHtml(g.lastMessage)}</div>` : '';
      return `
      <div class="list-item" onclick="Groups.openChat('${g.id}')">
        <div class="list-item-avatar">${Utils.getInitials(g.name)}</div>
        <div class="list-item-info">
          <div class="list-item-title">${Utils.escapeHtml(g.name)}</div>
          ${lastMsg}
        </div>
        <div class="list-item-meta">
          <div class="list-item-time">${g.lastMessageTime ? Utils.formatTime(g.lastMessageTime) : ''}</div>
          ${g.unread ? `<div class="list-item-badge">${g.unread}</div>` : ''}
        </div>
      </div>
    `;}).join('') + '</div>';
  },

  showCreate() {
    const contacts = Contacts.list;
    const selectEl = document.getElementById('group-members-select');
    if (!contacts.length) {
      selectEl.innerHTML = '<div style="color:var(--text-muted);padding:12px;">Add contacts first to create a group.</div>';
    } else {
      selectEl.innerHTML = contacts.map(c => `
        <div style="display:flex;align-items:center;gap:12px;padding:8px 0;">
          <input type="checkbox" id="gm-${c.flinkNumber}" value="${c.flinkNumber}" style="width:18px;height:18px;accent-color:var(--primary);">
          <label for="gm-${c.flinkNumber}" style="flex:1;cursor:pointer;">${Utils.escapeHtml(c.name)} <span style="color:var(--text-muted);font-size:13px;">(${c.flinkNumber})</span></label>
        </div>
      `).join('');
    }
    document.getElementById('group-name-input').value = '';
    document.getElementById('group-desc-input').value = '';
    UI.showScreen('group-create');
  },

  async create() {
    const name = document.getElementById('group-name-input').value.trim();
    const desc = document.getElementById('group-desc-input').value.trim();
    if (!name) { UI.toast('Enter a group name'); return; }

    const members = [];
    const myPin = Auth.getProfile().flinkNumber;
    members.push(myPin);
    document.querySelectorAll('#group-members-select input:checked').forEach(cb => members.push(cb.value));

    if (members.length < 2) { UI.toast('Add at least one member'); return; }

    const group = {
      id: Utils.generateId(),
      name,
      description: desc,
      members,
      createdBy: myPin,
      createdAt: Date.now(),
      lastMessage: '',
      lastMessageTime: 0,
      unread: 0
    };

    await Storage.set('groups', group);
    this.list.push(group);
    this.render();
    UI.toast('Group created');
    UI.goBack();
    this.openChat(group.id);
  },

  openChat(id) {
    const g = this.list.find(x => x.id === id);
    if (!g) return;
    this.currentId = id;
    g.unread = 0;
    Storage.set('groups', g);
    this.render();

    document.getElementById('group-chat-avatar').textContent = Utils.getInitials(g.name);
    document.getElementById('group-chat-name').textContent = g.name;
    document.getElementById('group-chat-members').textContent = `${g.members.length} members`;
    document.getElementById('group-chat-messages').innerHTML = '';
    UI.showScreen('group-chat');
    this.loadMessages(id);
  },

  async loadMessages(groupId) {
    const all = await Storage.getAll('messages');
    const msgs = all.filter(m => m.groupId === groupId).sort((a, b) => a.time - b.time);
    msgs.forEach(m => this.renderMessage(m));
    this.scrollToBottom();
  },

  renderMessage(msg) {
    const el = document.getElementById('group-chat-messages');
    const isMe = msg.from === Auth.getProfile().flinkNumber;
    const name = isMe ? 'You' : Contacts.getName(msg.from);
    const html = this.buildMessageHTML(msg, isMe, name);
    el.insertAdjacentHTML('beforeend', html);
    this.scrollToBottom();
  },

  buildMessageHTML(msg, isMe, name) {
    let content = '';
    if (msg.type === 'text') content = `<div>${Utils.escapeHtml(msg.content)}</div>`;
    else if (msg.type === 'image') content = `<img src="${msg.content}" class="message-media" onclick="Media.openViewer('${msg.content}','image')">`;
    else if (msg.type === 'video') content = `<video src="${msg.content}" class="message-media" controls onclick="event.stopPropagation()" playsinline></video>`;
    else if (msg.type === 'audio') content = `<div class="message-audio" onclick="Media.playAudio(this,'${msg.content}')"><svg><use href="#icon-play"/></svg><div class="message-audio-bar"></div><span style="font-size:12px;">Voice</span></div>`;
    else if (msg.type === 'file') content = `<div class="message-file"><div class="message-file-icon"><svg><use href="#icon-file"/></svg></div><div class="message-file-info"><div class="message-file-name">${Utils.escapeHtml(msg.fileName || 'File')}</div><div class="message-file-size">${msg.fileSize || ''}</div></div></div>`;
    else if (msg.type === 'sticker') content = `<div style="font-size:48px;text-align:center;">${msg.content}</div>`;

    return `
      <div class="message ${isMe ? 'sent' : 'received'}">
        <div style="font-size:12px;font-weight:500;margin-bottom:4px;opacity:0.7;">${Utils.escapeHtml(name)}</div>
        ${content}
        <div class="message-time">${Utils.formatTime(msg.time)}</div>
      </div>
    `;
  },

  scrollToBottom() {
    const el = document.getElementById('group-chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  },

  handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendText();
    }
  },

  async sendText() {
    const input = document.getElementById('group-chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    const myPin = Auth.getProfile().flinkNumber;
    const msg = {
      id: Utils.generateId(),
      groupId: this.currentId,
      from: myPin,
      type: 'text',
      content: text,
      time: Date.now()
    };

    await Storage.set('messages', msg);
    this.renderMessage(msg);

    const g = this.list.find(x => x.id === this.currentId);
    if (g) {
      g.lastMessage = text;
      g.lastMessageTime = Date.now();
      await Storage.set('groups', g);
      this.render();
    }

    g.members.forEach(member => {
      if (member !== myPin) {
        API.send({ type: 'chat', target: member, payload: { ...msg, groupId: this.currentId, groupName: g.name } });
      }
    });
  },

  async sendMedia(type, content, extra = {}) {
    const myPin = Auth.getProfile().flinkNumber;
    const msg = {
      id: Utils.generateId(),
      groupId: this.currentId,
      from: myPin,
      type,
      content,
      time: Date.now(),
      ...extra
    };
    await Storage.set('messages', msg);
    this.renderMessage(msg);

    const g = this.list.find(x => x.id === this.currentId);
    if (g) {
      g.lastMessage = type === 'image' ? 'Photo' : type === 'video' ? 'Video' : type === 'audio' ? 'Voice note' : 'File';
      g.lastMessageTime = Date.now();
      await Storage.set('groups', g);
      this.render();
    }

    g.members.forEach(member => {
      if (member !== myPin) {
        API.send({ type: 'chat', target: member, payload: { ...msg, groupId: this.currentId, groupName: g.name } });
      }
    });
  },

  showInfo() {
    const g = this.list.find(x => x.id === this.currentId);
    if (!g) return;
    document.getElementById('group-info-avatar').textContent = Utils.getInitials(g.name);
    document.getElementById('group-info-name').textContent = g.name;
    document.getElementById('group-info-desc').textContent = g.description || 'No description';
    document.getElementById('group-info-members').innerHTML = g.members.map(m => {
      const name = m === Auth.getProfile().flinkNumber ? 'You' : Contacts.getName(m);
      const role = m === g.createdBy ? '<span class="member-role">Admin</span>' : '';
      return `<div class="member-item"><div class="list-item-avatar" style="width:36px;height:36px;font-size:14px;">${Utils.getInitials(name)}</div><div style="flex:1;">${Utils.escapeHtml(name)} ${role}</div></div>`;
    }).join('');
    UI.showScreen('group-info');
  },

  async leaveGroup() {
    if (!confirm('Leave this group?')) return;
    const g = this.list.find(x => x.id === this.currentId);
    if (g) {
      g.members = g.members.filter(m => m !== Auth.getProfile().flinkNumber);
      await Storage.set('groups', g);
      if (g.members.length === 0) {
        await Storage.delete('groups', this.currentId);
        this.list = this.list.filter(x => x.id !== this.currentId);
      }
    }
    this.render();
    UI.toast('Left group');
    UI.goBack();
    UI.goBack();
  },

  receiveMessage(msg) {
    if (!msg.payload || !msg.payload.groupId) return;
    const g = this.list.find(x => x.id === msg.payload.groupId);
    if (!g) return;

    const existing = g.members.includes(msg.from);
    if (!existing) return;

    const m = {
      id: msg.payload.id || Utils.generateId(),
      groupId: msg.payload.groupId,
      from: msg.from,
      type: msg.payload.type || 'text',
      content: msg.payload.content,
      time: msg.payload.time || Date.now(),
      fileName: msg.payload.fileName,
      fileSize: msg.payload.fileSize
    };

    Storage.set('messages', m);
    g.lastMessage = m.type === 'text' ? m.content : m.type;
    g.lastMessageTime = m.time;
    if (this.currentId !== m.groupId) g.unread = (g.unread || 0) + 1;
    Storage.set('groups', g);
    this.render();

    if (this.currentId === m.groupId) {
      this.renderMessage(m);
    }
  }
};
