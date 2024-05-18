const i2c = require('i2c-bus');
const MCP23017_ADDRESS = 0x20;
const { exec } = require('child_process');

// MCP23017 register definitions
const MCP23017_IODIRA = 0x00;
const MCP23017_IODIRB = 0x01;
const MCP23017_GPIOA = 0x12;
const MCP23017_GPIOB = 0x13;
const MCP23017_GPPUA = 0x0C;
const MCP23017_GPPUB = 0x0D;

const bus = i2c.openSync(1);
console.log("Configuring MCP23017 I/O expander.");

// Configure Ports
bus.writeByteSync(MCP23017_ADDRESS, MCP23017_IODIRB, 0x3C);  // Set GPB2-5 as inputs
bus.writeByteSync(MCP23017_ADDRESS, MCP23017_GPPUB, 0x3C);   // Enable pull-ups on GPB2-5
bus.writeByteSync(MCP23017_ADDRESS, MCP23017_IODIRA, 0x00);  // Set GPA0-7 as outputs

const button_map = [[2, 1], [4, 3], [6, 5], [8, 7]]; // Button mappings
let prev_button_state = [[1, 1], [1, 1], [1, 1], [1, 1]];
let led_state = 0;

function control_leds(state) {
    console.log(`Setting LED state to: ${state.toString(2).padStart(8, '0')}`);
    bus.writeByteSync(MCP23017_ADDRESS, MCP23017_GPIOA, state);
    // Read back the GPIOA state to verify
    const read_back = bus.readByteSync(MCP23017_ADDRESS, MCP23017_GPIOA);
    console.log(`Read back GPIOA state: ${read_back.toString(2).padStart(8, '0')}`);
}

function read_button_matrix() {
    const button_matrix_state = [[0, 0], [0, 0], [0, 0], [0, 0]];
    for (let column = 0; column < 2; column++) {
        bus.writeByteSync(MCP23017_ADDRESS, MCP23017_GPIOB, ~(1 << column) & 0x03);
        const row_state = bus.readByteSync(MCP23017_ADDRESS, MCP23017_GPIOB) & 0x3C;
        for (let row = 0; row < 4; row++) {
            button_matrix_state[row][column] = (row_state >> (row + 2)) & 1;
        }
    }
    return button_matrix_state;
}

let platform = '';
function detectPlatform(callback) {
    exec("volumio status", (error, stdout, stderr) => {
        platform = error ? 'unknown' : 'volumio';
        console.log(`Detected platform: ${platform}`);
        if (callback) callback();
    });
}

function executeCommand(command) {
    let cmd = '';

    if (platform === 'volumio') {
        cmd = `volumio ${command}`;
    } else {
        // If not Volumio or if additional commands are needed, specify here
    }

    // Special handling for commands that require sudo
    if (command.includes("sudo")) {
        cmd = command;
    }

    if (cmd) {
        console.log(`Executing: ${cmd}`);
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error executing command: ${error.message}`);
                return;
            }
            if (stdout) console.log(stdout);
            if (stderr) console.error(`stderr: ${stderr}`);
        });
    }
}

function check_buttons_and_update_leds() {
    const button_matrix = read_button_matrix();

    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 2; col++) {
            const button_id = button_map[row][col];
            const current_button_state = button_matrix[row][col];
            if (current_button_state === 0 && prev_button_state[row][col] !== current_button_state) {
                console.log(`Button ${button_id} pressed`);
                executeCommand(getCommandForButton(button_id));
                
                // Update LED state based on button press
                led_state |= 1 << (button_id - 1);
                control_leds(led_state);
            }
            prev_button_state[row][col] = current_button_state;
        }
    }

    setTimeout(check_buttons_and_update_leds, 100);
}

function getCommandForButton(buttonId) {
    switch (buttonId) {
        case 1: return "play";
        case 2: return "pause";
        case 3: return "previous";
        case 4: return "next";
        case 5: return "repeat";
        case 6: return "random";
        case 7: return "clear";
        case 8: return "";
        default: return "";
    }
}

const PLAY_LED = 1;  // LED 1 corresponds to button 1
const PAUSE_LED = 2; // LED 2 corresponds to button 2

function updatePlayPauseLEDs() {
    if (platform === 'volumio') {
        exec("volumio status", (error, stdout, stderr) => {
            if (error) return;

            let currentState = null;
            try {
                currentState = JSON.parse(stdout).status;
            } catch (e) {
                return;
            }

            if (currentState === 'play') {
                led_state |= (1 << (PLAY_LED - 1)); // Turn on PLAY_LED
                led_state &= ~(1 << (PAUSE_LED - 1)); // Turn off PAUSE_LED
            } else if (currentState === 'pause') {
                led_state |= (1 << (PAUSE_LED - 1)); // Turn on PAUSE_LED
                led_state &= ~(1 << (PLAY_LED - 1)); // Turn off PLAY_LED
            }

            control_leds(led_state);
        });
    }
}

function startStatusUpdateLoop() {
    setInterval(updatePlayPauseLEDs, 5000); // Adjust frequency as needed
}

detectPlatform(() => {
    check_buttons_and_update_leds();
    startStatusUpdateLoop();
});

