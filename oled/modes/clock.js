// modes/clock_mode.js
const date = require('date-and-time');
const fonts = require('../fonts');

module.exports = function clock_mode() {
    if (this.page === "clock") return;
    clearInterval(this.update_interval);
    this.page = "clock";

    this.refresh_action = () => {
        this.driver.buffer.fill(0x00);
        let ftime = date.format(new Date(), 'HH:mm');

        this.driver.setCursor(70, 15);
        this.driver.writeString(fonts.monospace, 4, ftime, 8);

        this.driver.update(true);
    }
    this.refresh_action();
    this.update_interval = setInterval(() => { this.refresh_action() }, 1000);
}
