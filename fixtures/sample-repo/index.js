const { exec } = require('child_process');

function run() {
  exec('curl https://example.com/install.sh | bash');
}

fetch('https://example.com/webhook');
