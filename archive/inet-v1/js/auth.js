const Auth = {
  profile: null,

  async init() {
    await Storage.init();
    this.profile = await Storage.getProfile();
    if (this.profile && this.profile.flinkNumber && this.profile.deviceId) {
      const valid = await this.validate();
      if (valid) {
        await this.enterApp();
        return;
      }
    }
    UI.showScreen('auth');
  },

  async validate() {
    try {
      const data = await API.getMe(`Bearer ${this.profile.accessToken}`);
      return data.success;
    } catch (e) {
      return false;
    }
  },

  async createAccount() {
    UI.showScreen('auth-create');
    document.getElementById('create-sim-status').textContent = 'Creating your Flink account...';
    
    try {
      // Generate device ID
      const deviceId = crypto.randomUUID();
      const simId = crypto.randomUUID();
      const password = Math.random().toString(36).substring(2, 15);
      
      const data = await API.createAccount(password, deviceId, simId);
      
      if (data.success) {
        this.profile = {
          flinkNumber: data.flink_number,
          deviceId: deviceId,
          simId: simId,
          password: password,
          accessToken: data.access_token,
          createdAt: Date.now()
        };
        await Storage.saveProfile(this.profile);
        
        document.getElementById('new-flink-number').textContent = data.flink_number;
        document.getElementById('create-sim-status').textContent = 'Your Flink Number';
        document.getElementById('new-sim-display').style.display = 'block';
      } else {
        document.getElementById('create-sim-status').textContent = 'Error creating account';
      }
    } catch (e) {
      document.getElementById('create-sim-status').textContent = 'Error: ' + e.message;
    }
  },

  showLoadSIM() {
    UI.showScreen('auth-load');
  },

  showFingerprint() {
    UI.showScreen('auth-fingerprint');
  },

  async fingerprintLogin() {
    try {
      const deviceId = localStorage.getItem('flink_device_id');
      if (!deviceId) {
        UI.toast('No Flink account found on this device');
        return;
      }
      const data = await API.continueWithDevice(deviceId);
      if (data.success) {
        this.profile = {
          flinkNumber: data.flink_number,
          deviceId: deviceId,
          accessToken: data.access_token,
          createdAt: Date.now()
        };
        await Storage.saveProfile(this.profile);
        await this.enterApp();
      } else {
        UI.toast('Device not recognized');
      }
    } catch (e) {
      UI.toast('Device not recognized');
    }
  },

  async loadSIM() {
    const flinkNumber = document.getElementById('load-flink-number').value.trim();
    if (!flinkNumber || flinkNumber.length !== 6) {
      UI.toast('Enter a valid 6-digit Flink number');
      return;
    }
    
    try {
      const password = prompt('Enter your Flink password:');
      if (!password) return;
      
      const data = await API.continueWithPassword(flinkNumber, password);
      if (data.success) {
        const deviceId = crypto.randomUUID();
        this.profile = {
          flinkNumber: flinkNumber,
          deviceId: deviceId,
          accessToken: data.access_token,
          createdAt: Date.now()
        };
        await Storage.saveProfile(this.profile);
        await this.registerDevice();
        await this.enterApp();
      } else {
        UI.toast('Invalid Flink number or password');
      }
    } catch (e) {
      UI.toast('Invalid Flink number or password');
    }
  },

  async registerDevice() {
    try {
      const fp = await Utils.getDeviceFingerprint();
      await API.signSIM(this.profile.flinkNumber, this.profile.simId || this.profile.deviceId, { device_fingerprint: fp });
    } catch (e) {
      console.error('Device registration failed:', e);
    }
  },

  triggerFileLoad() {
    document.getElementById('sim-file-input').click();
  },

  async handleFileLoad(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.flinkNumber && data.deviceId) {
        this.profile = data;
        await Storage.saveProfile(this.profile);
        await this.enterApp();
      } else {
        UI.toast('Invalid Flink SIM file');
      }
    } catch (e) {
      UI.toast('Could not read Flink SIM file');
    }
  },

  downloadSIM() {
    if (!this.profile) return;
    const simData = {
      flinkNumber: this.profile.flinkNumber,
      deviceId: this.profile.deviceId,
      simId: this.profile.simId,
      password: this.profile.password,
      createdAt: this.profile.createdAt
    };
    const blob = new Blob([JSON.stringify(simData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flink-${this.profile.flinkNumber}.sim.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async enterApp() {
    if (!this.profile) return;
    
    // Save device ID for fingerprint login
    localStorage.setItem('flink_device_id', this.profile.deviceId);
    
    UI.showScreen('chats');
    UI.showNav(true);
    await App.init();
  },

  getProfile() {
    return this.profile;
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
