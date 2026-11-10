const API = {
  BASE_URL: 'https://emltechstudio-inet-v2.hf.space',
  WS_URL: 'wss://emltechstudio-inet-v2.hf.space',
  ws: null,
  reconnectTimer: null,
  pingInterval: null,
  listeners: {},
  isConnected: false,

  // REST API helpers
  async request(endpoint, options = {}) {
    const url = `${this.BASE_URL}${endpoint}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || `HTTP ${res.status}`);
    }
    return res.json();
  },

  // Flink Auth endpoints
  createAccount(password, deviceId, simId) {
    return this.request('/flink/auth/account', {
      method: 'POST',
      body: JSON.stringify({ password, device_id: deviceId, sim_id: simId })
    });
  },

  continueWithPassword(flinkNumber, password) {
    return this.request('/flink/auth/continue/password', {
      method: 'POST',
      body: JSON.stringify({ flink_number: flinkNumber, password })
    });
  },

  continueWithDevice(deviceId) {
    return this.request('/flink/auth/continue/device', {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId })
    });
  },

  continueWithSIM(payload, signature) {
    return this.request('/flink/auth/continue/sim', {
      method: 'POST',
      body: JSON.stringify({ payload, signature })
    });
  },

  getSIMPublicKey() {
    return this.request('/flink/auth/sim/public-key');
  },

  signSIM(flinkNumber, simId, metadata = {}) {
    return this.request('/flink/auth/sim/sign', {
      method: 'POST',
      body: JSON.stringify({ flink_number: flinkNumber, sim_id: simId, metadata })
    });
  },

  getMe(authorization) {
    return this.request('/flink/auth/me', {
      headers: { Authorization: authorization }
    });
  },

  registerPush(flinkNumber, deviceId, subscription, authorization) {
    return this.request('/flink/auth/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ flink_number: flinkNumber, device_id: deviceId, ...subscription }),
      headers: { Authorization: authorization }
    });
  },

  getVapidKey() {
    return this.request('/flink/auth/push/public-key');
  },

  createGroup(name, memberNumbers, authorization) {
    return this.request('/flink/auth/groups', {
      method: 'POST',
      body: JSON.stringify({ name, member_numbers: memberNumbers }),
      headers: { Authorization: authorization }
    });
  },

  listGroups(authorization) {
    return this.request('/flink/auth/groups', {
      headers: { Authorization: authorization }
    });
  },

  addGroupMembers(groupId, memberNumbers, authorization) {
    return this.request(`/flink/auth/groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify({ member_numbers: memberNumbers }),
      headers: { Authorization: authorization }
    });
  },

  removeGroupMember(groupId, flinkNumber, authorization) {
    return this.request(`/flink/auth/groups/${groupId}/members/${flinkNumber}`, {
      method: 'DELETE',
      headers: { Authorization: authorization }
    });
  },

  // Flink Signaling endpoints
  signalingHealth() {
    return this.request('/flink/signaling/health');
  },

  sendPing(targetFlinkNumber, mode, sessionId, authorization) {
    return this.request('/flink/signaling/ping', {
      method: 'POST',
      body: JSON.stringify({ target_flink_number: targetFlinkNumber, mode, session_id: sessionId }),
      headers: { Authorization: authorization }
    });
  },

  sendGroupPing(groupId, mode, sessionId, authorization) {
    return this.request('/flink/signaling/group-ping', {
      method: 'POST',
      body: JSON.stringify({ group_id: groupId, mode, session_id: sessionId }),
      headers: { Authorization: authorization }
    });
  },

  // WebSocket for signaling
  connect(flinkNumber, deviceId, token) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    const sessionId = `${flinkNumber}-${deviceId}`;
    const url = `${this.WS_URL}/flink/signaling/ws/${sessionId}?token=${encodeURIComponent(token)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.isConnected = true;
      clearTimeout(this.reconnectTimer);
      this.startPing();
      this.emit('connected');
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        this.handleMessage(msg);
      } catch (err) {
        console.error('WS parse error:', err);
      }
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      this.stopPing();
      this.emit('disconnected');
      this.reconnectTimer = setTimeout(() => this.connect(flinkNumber, deviceId, token), 3000);
    };

    this.ws.onerror = (err) => {
      console.error('WS error:', err);
      this.emit('error', err);
    };
  },

  disconnect() {
    clearTimeout(this.reconnectTimer);
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  },

  startPing() {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  },

  stopPing() {
    clearInterval(this.pingInterval);
  },

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  },

  // Message routing
  handleMessage(msg) {
    const type = msg.type;
    if (type === 'pong') return;
    if (type === 'chat') {
      this.emit('chat', msg);
      return;
    }
    if (type === 'offline_messages') {
      this.emit('offline_messages', msg.messages);
      return;
    }
    if (type === 'status_change') {
      this.emit('status_change', msg.payload);
      return;
    }
    if (['call_offer', 'call_answer', 'call_end', 'call_busy', 'ice_candidate'].includes(type)) {
      this.emit('call_signal', msg);
      return;
    }
    if (['gc_join', 'gc_leave', 'gc_invite', 'gc_members'].includes(type)) {
      this.emit('group_call', msg);
      return;
    }
    if (type === 'otp') {
      this.emit('otp', msg.payload);
      return;
    }
    if (type === 'flink_request') {
      this.emit('flink_request', msg);
      return;
    }
    if (type === 'flink_group_request') {
      this.emit('flink_group_request', msg);
      return;
    }
    this.emit(type, msg);
  },

  // Event system
  on(event, handler) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  },

  off(event, handler) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(h => h !== handler);
  },

  emit(event, data) {
    if (!this.listeners[event]) return;
    this.listeners[event].forEach(h => {
      try { h(data); } catch (e) { console.error(e); }
    });
  }
};
