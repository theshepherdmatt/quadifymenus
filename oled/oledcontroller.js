const date = require('date-and-time');
const oled = require('./oled.js');
const fonts = require('./fonts.js');

const REFRESH_TRACK = 20;
let api_state_waiting = false;
let extn_exit_sleep_mode = false;
let currentMode = 'clock';

class APOled {
    constructor(opts, timeBeforeClock, timeBeforeScreensaver, timeBeforeDeepSleep) {
        this.opts = opts;
        this.TIME_BEFORE_CLOCK = timeBeforeClock;
        this.TIME_BEFORE_SCREENSAVER = timeBeforeScreensaver;
        this.TIME_BEFORE_DEEPSLEEP = timeBeforeDeepSleep;
        this.scroller_x = 0;
        this.streamerData = {};
        this.ip = null;
        this.height = opts.height;
        this.width = opts.width;
        this.page = null;
        this.data = {
            title: null,
            artist: null,
            album: null,
            volume: null,
            samplerate: null,
            bitdepth: null,
            bitrate: null,
            seek: null,
            duration: null
        };
        this.raw_seek_value = 0;
        this.footertext = "";
        this.update_interval = null;
        this.refresh_track = REFRESH_TRACK;
        this.refresh_action = null;
        this.driver = new oled(opts);
        this.dimmed = false;
    }

    volumio_seek_format(seek, duration) {
        let ratiobar = 0;
        try {
            if (duration) ratiobar = (seek / (duration * 1000) * (this.width - 6));
        } catch (e) { ratiobar = 0; }

        let seek_string = "00:00 / 00:00";
        try { duration = new Date(duration * 1000).toISOString().substr(14, 5); } catch (e) { duration = "00:00"; }
        try { seek = new Date(seek).toISOString().substr(14, 5); } catch (e) { seek = "00:00"; }

        seek_string = seek + " / " + duration;
        return { seek_string, ratiobar };
    }

    listen_to(api, frequency) {
        frequency = frequency || 1000;
        let api_caller = null;

        console.log(`Listening to ${api} with frequency ${frequency}ms`);

        if (api === "volumio") {
            const io = require('socket.io-client');
            const socket = io.connect('http://localhost:3000');

            api_caller = setInterval(() => {
                if (api_state_waiting) return;
                api_state_waiting = true;
                socket.emit("getState");
            }, frequency);
            let first = true;

            socket.emit("getState"); // Initial state request
            socket.on("pushState", (data) => {
                let exit_sleep = false;
                if (extn_exit_sleep_mode) {
                    extn_exit_sleep_mode = false;
                    exit_sleep = true;
                }
                if (first) {
                    first = false;
                    socket.emit("getState");
                    return;
                }
                api_state_waiting = false;

                if (data.status === "play" && currentMode !== "playback") {
                    this.playback_mode(); // Switch to playback mode when playback starts
                    currentMode = "playback";
                } else if (data.status !== "play" && currentMode !== "clock") {
                    currentMode = "clock";
                    if (this.page !== "clock") {
                        this.clock_mode(); // Switch back to clock mode when playback stops
                    }
                }

                if (this.data.title !== data.title ||
                    this.data.artist !== data.artist ||
                    this.data.album !== data.album) {
                    this.text_to_display = data.title + (data.artist ? " - " + data.artist : "");
                    this.driver.CacheGlyphsData(this.text_to_display);
                    this.text_width = this.driver.getStringWidthUnifont(this.text_to_display + " - ");
                    this.scroller_x = 0;
                    this.refresh_track = REFRESH_TRACK;
                    this.footertext = "";
                    exit_sleep = true;
                }

                if (this.data.volume !== data.volume) {
                    exit_sleep = true;
                }

                let seek_data = this.volumio_seek_format(data.seek, data.duration);

                if (data.status !== "play" && this.raw_seek_value !== data.seek) {
                    exit_sleep = true;
                }
                this.raw_seek_value = data.seek;

                if (data.status === "play") {
                    exit_sleep = true;
                }

                this.footertext = "";
                if (!data.samplerate && !data.bitdepth && !data.bitrate) {
                    socket.emit("getQueue");
                } else {
                    if (data.samplerate) this.footertext += data.samplerate.toString().replace(/\s/gi, "") + " ";
                    if (data.bitdepth) this.footertext += data.bitdepth.toString().replace(/\s/gi, "") + " ";
                    if (data.bitrate) this.footertext += data.bitrate.toString().replace(/\s/gi, "") + " ";
                }

                this.data = data; // Updating internal state
                this.data.seek_string = seek_data.seek_string;
                this.data.ratiobar = seek_data.ratiobar;

                this.handle_sleep(exit_sleep);
            });

            socket.on("pushQueue", (resdata) => {
                let data = resdata[0];
                if (!this.footertext && data) {
                    if (data.samplerate) this.footertext += data.samplerate.toString().replace(/\s/gi, "") + " ";
                    if (data.bitdepth) this.footertext += data.bitdepth.toString().replace(/\s/gi, "") + " ";
                    if (data.bitrate) this.footertext += data.bitrate.toString().replace(/\s/gi, "") + " ";
                }
            });
        }
    }

    snake_screensaver() {
        if (this.page === "snake_screensaver") return;
        clearInterval(this.update_interval);
        this.page = "snake_screensaver";

        let box_pos = [0, 0];
        let count = 0;
        let flip = false;
        let tail = [];
        let tail_max = 25;
        let t_tail_length = 1;
        let random_pickups = [];
        let screen_saver_animation_reset = () => {
            tail = [];
            count = 0;
            t_tail_length = 10;
            random_pickups = [];
            let nb = 7;
            while (nb--) {
                let _x = Math.floor(Math.random() * (this.width));
                let _y = Math.floor(Math.random() * (this.height / 3)) * 3;
                random_pickups.push([_x, _y]);
            }
        }
        screen_saver_animation_reset();
        this.refresh_action = () => {
            this.driver.buffer.fill(0x00);
            let x;
            if (count % this.width == 0) { flip = !flip }
            if (flip) x = count % this.width + 1
            else x = this.width - count % this.width
            let y = ~~(count / this.width) * 3
            tail.push([x, y]);
            if (tail.length > t_tail_length) tail.shift();
            for (let i of tail) {
                this.driver.fillRect(i[0], i[1] - 1, 2, 3, 1);
            }
            for (let r of random_pickups) {
                if (((flip && x >= r[0]) || (!flip && x <= r[0])) && y >= r[1]) {
                    t_tail_length += 5;
                    random_pickups.splice(random_pickups.indexOf(r), 1)
                }
                this.driver.fillRect(r[0], r[1], 1, 1, 1);
            }
            count++;
            this.driver.update(true);
            if (y > this.height) screen_saver_animation_reset();
        }
        this.update_interval = setInterval(() => { this.refresh_action() }, 40);
    }

    deep_sleep() {
        if (this.page === "deep_sleep") return;
        this.status_off = true;
        clearInterval(this.update_interval);
        this.page = "deep_sleep";
        this.driver.turnOffDisplay();
    }

    clock_mode() {
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

    playback_mode() {
        if (this.page === "playback") return;
        clearInterval(this.update_interval);

        this.scroller_x = 0;
        this.page = "playback";
        this.text_to_display = this.text_to_display || "";
        this.refresh_track = REFRESH_TRACK;
        this.refresh_action = () => {
            if (this.plotting) { return }; // skip plotting of this frame if the pi has not finished plotting the previous frame
            this.plotting = true;

            this.driver.buffer.fill(0x00);

            if (this.data) {
                // volume
                if (this.data.volume !== null) {
                    let volstring = this.data.volume.toString();
                    if (this.data.mute === true || volstring === "0") volstring = "X";

                    this.driver.setCursor(4, this.height - 20); // Move volume display down
                    this.driver.writeString(fonts.icons, 1, "0", 5); // Volume icon
                    this.driver.setCursor(14, this.height - 19); // Adjust accordingly
                    this.driver.writeString(fonts.monospace, 1, volstring, 5); // Volume level
                }

                // Repeat Single or Repeat All
                if (this.data.repeatSingle) {
                    this.driver.setCursor(232, this.height - 20); // Move repeat single symbol down
                    this.driver.writeString(fonts.icons, 1, "5", 5); // Repeat single symbol
                } else if (this.data.repeat) {
                    this.driver.setCursor(232, this.height - 20); // Move repeat all symbol down
                    this.driver.writeString(fonts.icons, 1, "4", 5); // Repeat all symbol
                }

                if (this.data) {
                    // Combine trackType and footertext
                    let combinedInfo = `${this.data.trackType || ''} ${this.footertext || ''}`.trim();

                    // Assuming an average character width for calculation
                    let combinedInfoWidth = combinedInfo.length * 6; // Adjust the multiplier based on your font and display
                    let startX = (this.width - combinedInfoWidth) / 2; // Calculate X to center the combined string
                    let infoYPosition = this.height - 20; // Adjust Y position as needed

                    this.driver.setCursor(startX, infoYPosition);
                    this.driver.writeString(fonts.monospace, 1, combinedInfo, 5);
                }

                // play pause stop logo
                if (this.data.status) {
                    let status_symbol = "";
                    switch (this.data.status) {
                        case ("play"):
                            status_symbol = "1";
                            break;
                        case ("pause"):
                            status_symbol = "2"
                            break;
                        case ("stop"):
                            status_symbol = "3"
                            break;
                    }

                    this.driver.setCursor(246, this.height - 20); // Move play/pause/stop logo down
                    this.driver.writeString(fonts.icons, 1, status_symbol, 6);
                }

                if (this.text_to_display.length) {
                    let splitIndex = this.text_to_display.indexOf(" - ");
                    let title = this.text_to_display.substring(0, splitIndex);
                    let artist = this.text_to_display.substring(splitIndex + 3);

                    const handleTextDisplay = (text, initialY) => {
                        let textWidth = this.driver.getStringWidthUnifont(text);
                        if (textWidth > this.width) {
                            if (!this.scrollX) this.scrollX = 0;
                            this.driver.cursor_x = this.scrollX;
                            this.scrollX = this.scrollX - 1 < -textWidth ? this.width : this.scrollX - 1;
                        } else {
                            this.driver.cursor_x = (this.width - textWidth) / 2;
                        }
                        this.driver.cursor_y = initialY;
                        this.driver.writeStringUnifont(text, 6);
                    };

                    handleTextDisplay(title, 0); // For title
                    handleTextDisplay(artist, 18); // For artist, placed below the title
                }

                if (this.data.seek_string) {
                    let border_right = this.width - 5;
                    let bottomY = this.height - 7;
                    this.driver.drawLine(3, bottomY, border_right, bottomY, 3);
                    this.driver.drawLine(border_right, bottomY, border_right, this.height - 4, 3);
                    this.driver.drawLine(3, this.height - 4, border_right, this.height - 4, 3);
                    this.driver.drawLine(3, this.height - 4, 3, bottomY, 3);
                    this.driver.fillRect(3, bottomY, this.data.ratiobar, 4, 4);
                    this.driver.cursor_y = 43;
                    this.driver.cursor_x = 93;
                    this.driver.writeString(fonts.monospace, 0, this.data.seek_string, 5);
                }
            }

            this.driver.update();
            this.plotting = false;
            if (this.refresh_track) return this.refresh_track--;
            this.scroller_x--;
        }

        this.update_interval = setInterval(() => { this.refresh_action() }, this.opts.main_rate);
        this.refresh_action();
    }

    handle_sleep(exit_sleep) {
        if (!exit_sleep) { // Should the display go into sleep mode?
            if (!this.iddle_timeout) { // Check if the screen is not already waiting to go into sleep mode (instruction initiated in a previous cycle).
                let _deepsleep_ = () => { this.deep_sleep(); }
                let _screensaver_ = () => {
                    this.snake_screensaver();
                    this.iddle_timeout = setTimeout(_deepsleep_, this.TIME_BEFORE_DEEPSLEEP);
                }
                let _clock_ = () => {
                    if (currentMode !== "playback") {
                        this.clock_mode();
                    }
                    this.iddle_timeout = setTimeout(_screensaver_, this.TIME_BEFORE_SCREENSAVER);
                }
                this.iddle_timeout = setTimeout(_clock_, this.TIME_BEFORE_CLOCK);
            }
        } else {
            if (this.status_off) {
                this.status_off = null;
                this.driver.turnOnDisplay();
            }

            if (this.page !== "playback" && currentMode === "playback") {
                this.playback_mode();
            }

            if (this.iddle_timeout) {
                clearTimeout(this.iddle_timeout);
                this.iddle_timeout = null;
            }
        }
    }
}

module.exports = APOled;
