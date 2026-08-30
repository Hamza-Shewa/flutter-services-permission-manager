export class MessageBus {
  constructor() {
    this.listeners = new Map();
    window.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || !message.type) {return;}
      this.emit(message.type, message);
    });
  }

  on(type, callback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(callback);
    return this;
  }

  emit(type, payload) {
    const callbacks = this.listeners.get(type) || [];
    callbacks.forEach((cb) => {
      try {
        cb(payload);
      } catch (err) {
        console.error(`[MessageBus] Error in handler for ${type}:`, err);
      }
    });
  }
}

export const bus = new MessageBus();
