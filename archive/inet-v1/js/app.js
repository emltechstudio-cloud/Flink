const App = {
  async init() {
    const profile = Auth.getProfile();
    if (!profile) return;

    // Connect WebSocket with token
    API.connect(profile.flinkNumber, profile.deviceId, profile.accessToken);

    // Setup WS listeners
    API.on('connected', () => {
      UI.toast('Connected to Flink');
      this.updateContactsStatus();
    });
    API.on('disconnected', () => UI.toast('Disconnected'));
    API.on('connection_only', (msg) => UI.toast(msg.message || 'Messages are available only while connected peer-to-peer'));
    API.on('status_change', (payload) => {
      if (Chat.currentFlinkNumber === payload.flink_number) {
        document.getElementById('chat-status').textContent = payload.online ? 'online' : 'last seen ' + Utils.formatTime(payload.last_seen);
      }
    });
    API.on('call_signal', (msg) => {
      if (msg.type === 'call_offer') Calls.receiveCallOffer(msg);
      else if (msg.type === 'call_answer') Calls.handleCallAnswer(msg);
      else if (msg.type === 'call_end') Calls.handleCallEnd(msg);
      else if (msg.type === 'call_busy') Calls.handleCallBusy(msg);
      else if (msg.type === 'ice_candidate') Calls.handleIceCandidate(msg);
    });
    API.on('group_call', (msg) => Calls.handleGroupSignal(msg));
    API.on('flink_request', (msg) => this.handleFlinkRequest(msg));
    API.on('flink_group_request', (msg) => this.handleGroupRequest(msg));

    // Init modules
    await Contacts.init();
    await Groups.init();
    await Chat.init();
    await Calls.init();
    UI.init();

    // Load settings
    const darkMode = await Storage.getSetting('darkMode', true);
    if (!darkMode) document.body.classList.add('light-mode');

    // Update settings UI
    document.getElementById('settings-my-flink-number').textContent = profile.flinkNumber;

    // Check for link call in URL
    const joined = await LinkCalls.joinFromUrl();
    if (!joined) {
      UI.showScreen('chats');
      UI.showNav(true);
    }

    // Request push notification permission
    this.setupPush();
  },

  async updateContactsStatus() {
    const numbers = Contacts.list.map(c => c.flinkNumber);
    if (!numbers.length) return;
    try {
      // For now, we don't have batch status in the new backend
      // This would need to be added if needed
    } catch (e) {
      console.error('Status update failed:', e);
    }
  },

  async handleFlinkRequest(msg) {
    // Handle incoming flink request (ping, voice, video)
    const profile = Auth.getProfile();
    if (!profile || profile.flinkNumber === msg.from) return;
    
    const mode = msg.mode || 'ping';
    const sessionId = msg.session_id;
    const from = msg.from;
    
    if (mode === 'ping') {
      UI.toast(`Ping from ${Contacts.getName(from) || from}`);
      // Could trigger a notification or open a chat
      Chat.currentFlinkNumber = from;
    } else if (mode === 'voice' || mode === 'video') {
      // Incoming call request
      Calls.receiveCallRequest(from, mode === 'video', sessionId);
    }
  },

  async handleGroupRequest(msg) {
    // Handle incoming group request
    const profile = Auth.getProfile();
    if (!profile) return;
    
    const mode = msg.mode || 'ping';
    const sessionId = msg.session_id;
    const groupId = msg.group_id;
    const from = msg.from;
    
    if (mode === 'ping') {
      UI.toast(`Group ping from ${Contacts.getName(from) || from}`);
    } else if (mode === 'voice' || mode === 'video') {
      // Incoming group call request
      Calls.receiveGroupCallRequest(groupId, mode === 'video', sessionId);
    }
  },

  async setupPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const keyData = await API.getVapidKey();
        const key = keyData.public_key;
        if (key) {
          const newSub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: this.urlBase64ToUint8Array(key)
          });
          const profile = Auth.getProfile();
          await API.registerPush(profile.flinkNumber, profile.deviceId, newSub.toJSON(), `Bearer ${profile.accessToken}`);
        }
      }
    } catch (e) {
      console.error('Push setup failed:', e);
    }
  },

  urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
  }
};

// ============================================================
// Settings module
// ============================================================
const Settings = {
  async toggleDarkMode() {
    const isDark = !document.body.classList.contains('light-mode');
    document.body.classList.toggle('light-mode', isDark);
    await Storage.setSetting('darkMode', !isDark);
    document.getElementById('dark-mode-toggle').classList.toggle('active', !isDark);
  },

  showProfile() {
    const profile = Auth.getProfile();
    UI.showModal('My Profile', `
      <div style="text-align:center;padding:16px;">
        <div class="list-item-avatar" style="width:80px;height:80px;font-size:32px;margin:0 auto 12px;">${profile.flinkNumber.slice(0,2)}</div>
        <div style="font-size:22px;font-weight:600;margin-bottom:4px;">Flink ${profile.flinkNumber}</div>
        <div style="font-size:13px;color:var(--text-muted);">Device: ${profile.deviceId.slice(0,8)}...</div>
      </div>
    `, [{ label: 'Close', class: 'primary', action: () => UI.hideModal() }]);
  },

  downloadSIM() {
    Auth.downloadSIM();
    UI.toast('Flink SIM file downloaded');
  },

  async logout() {
    if (!confirm('Logout and clear all data?')) return;
    API.disconnect();
    await Storage.clearProfile();
    await Storage.clear('messages');
    await Storage.clear('contacts');
    await Storage.clear('groups');
    await Storage.clear('call_log');
    localStorage.removeItem('flink_device_id');
    location.reload();
  }
};

// ============================================================
// Dialpad module
// ============================================================
const Dialpad = {
  display: '',

  press(key) {
    if (this.display.length >= 12) return;
    this.display += key;
    this.updateDisplay();
  },

  backspace() {
    this.display = this.display.slice(0, -1);
    this.updateDisplay();
  },

  updateDisplay() {
    document.getElementById('dial-display').textContent = this.display;
  },

  audioCall() {
    if (this.display.length !== 6) { UI.toast('Enter a valid 6-digit Flink number'); return; }
    Chat.currentFlinkNumber = this.display;
    // Send a ping request first
    const profile = Auth.getProfile();
    if (profile) {
      const sessionId = crypto.randomUUID();
      API.sendPing(this.display, 'voice', sessionId, `Bearer ${profile.accessToken}`)
        .then(() => {
          // Start call after ping
          Calls.startCall(false);
        })
        .catch(() => {
          // Even if ping fails, try to call directly
          Calls.startCall(false);
        });
    } else {
      Calls.startCall(false);
    }
    this.display = '';
    this.updateDisplay();
  },

  videoCall() {
    if (this.display.length !== 6) { UI.toast('Enter a valid 6-digit Flink number'); return; }
    Chat.currentFlinkNumber = this.display;
    const profile = Auth.getProfile();
    if (profile) {
      const sessionId = crypto.randomUUID();
      API.sendPing(this.display, 'video', sessionId, `Bearer ${profile.accessToken}`)
        .then(() => {
          Calls.startCall(true);
        })
        .catch(() => {
          Calls.startCall(true);
        });
    } else {
      Calls.startCall(true);
    }
    this.display = '';
    this.updateDisplay();
  }
};

// ============================================================
// Start app on load
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  Auth.init();
});
