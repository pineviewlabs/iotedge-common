const assert = require('assert');
const Monitor = require('../../utils/monitor.js');

describe('Retry Tests', function() {

  this.timeout(10000);

  it('test retry with backoff', function(done) {
    const monitor = new Monitor({
      operation: function({attempt, timeoutMs}) {
        if (attempt === 4) {
          return true;
        }

        return false;
      },
      minTimeout: 100,
      maxTimeout: 500,
      onResult: function(result, {timeoutMs, attempt}) {
        //console.log('onResult', result, attempt, timeoutMs, monitor.times);

        if (monitor.times === 2) {
          monitor.stop();
          assert.strictEqual(monitor.timeoutId, 0);
          done();
        }
      }
    });

    monitor.perform();
  });

});
