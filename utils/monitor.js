function getTimeout({minTimeout = 1000, factor = 2, attempt, maxTimeout = 30000}) {
  let random = Math.random() + 1;
  let timeout = Math.round(random * minTimeout * Math.pow(factor, attempt));
  timeout = Math.min(timeout, maxTimeout);

  return timeout;
}


module.exports = class Monitor {
  /**
   * @param {number} opts.maxTimeout
   * @param {number} opts.minTimeout
   * @param {function} opts.operation
   * @param {function} opts.onResult
   */
  constructor(opts = {}) {
    this.timeoutId = null;
    this.options = opts;
    this.stopped = false;
    this.attempt = 0;
    this.times = 0;
    this.currentResult = true;
  }

  perform() {
    const {maxTimeout, minTimeout, operation, onResult} = this.options;

    const {attempt} = this;

    let timeoutMs = getTimeout({
      maxTimeout,
      minTimeout,
      attempt
    });

    this.timeoutId = setTimeout(() => {
      this.attempt++;

      let result = operation({attempt, timeoutMs});
      if (result && !this.currentResult) {
        this.reset();
      }

      this.currentResult = result;
      onResult(result, {timeoutMs, attempt});

      if (!this.stopped) {
        this.perform();
      }
    }, timeoutMs);
  }

  reset() {
    this.times++;
    this.attempt = 0;
  }

  stop() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    this.timeoutId = 0;
    this.stopped = true;
  }
};



