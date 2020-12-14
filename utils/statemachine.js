const Events = require('events');

module.exports = class StateMachine extends Events {
  constructor({broadcastInterval, states}) {
    super();

    this.lastBroadcastTime = null;
    this.broadcastInterval = broadcastInterval;

    const {stateOK, stateALERT} = states;
    this.states = {
      stateOK,
      stateALERT
    };
  }

  broadcastStateChange(newState, oldState) {
    if (newState !== oldState && oldState) {
      return true;
    }

    if (!this.lastBroadcastTime) {
      this.lastBroadcastTime = Date.now();

      return false;
    }

    if (newState === this.states.stateALERT) {
      return false;
    }

    return Date.now() - this.lastBroadcastTime > this.broadcastInterval;
  }

  stateChange(newState, prevState, opts) {
    this.emit('beforeChange', newState, prevState);
    this.currentState = newState;

    if (this.broadcastStateChange(newState, prevState)) {
      this.lastBroadcastTime = Date.now();
      this.emit('change', {state: this.currentState, prevState, ...opts});
    }
  }

  stateAlert(opts = {}) {
    this.stateChange(this.states.stateALERT, this.currentState, opts);
  }

  stateOk(opts = {}) {
    this.stateChange(this.states.stateOK, this.currentState, opts);
  }

};
