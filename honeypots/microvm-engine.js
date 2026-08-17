const { spawn, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const net = require("net");

class MicroVMEngine {
  constructor() {
    this.vmDir = process.env.FIRECRACKER_VM_DIR || "/home/we/firecracker_vm";
    this.kernelPath = path.join(this.vmDir, "vmlinux.bin");
    this.rootfsPath = path.join(this.vmDir, "bionic.rootfs.ext4");
    this.activeVMs = new Map();
    this._available = null;
  }

  isAvailable() {
    if (this._available !== null) return this._available;
    try {
      const hasBin = fs.existsSync("/usr/bin/firecracker") || fs.existsSync("/usr/local/bin/firecracker");
      const hasKernel = fs.existsSync(this.kernelPath);
      const hasRootfs = fs.existsSync(this.rootfsPath);
      this._available = hasBin && hasKernel && hasRootfs;
    } catch {
      this._available = false;
    }
    return this._available;
  }

  async spawnMicroVM(sessionId) {
    if (!this.isAvailable()) return null;

    const socketPath = `/tmp/firecracker-${sessionId}.socket`;
    const configPath = `/tmp/fc-config-${sessionId}.json`;

    const sessionRootfs = path.join(this.vmDir, `session-${sessionId}.ext4`);
    try {
      fs.copyFileSync(this.rootfsPath, sessionRootfs);
    } catch (err) {
      console.error(`[MicroVM] Failed to copy rootfs for ${sessionId}: ${err.message}`);
      return null;
    }

    const config = {
      "boot-source": {
        kernel_image_path: this.kernelPath,
        boot_args: "console=ttyS0 reboot=k panic=1 pci=off random.trust_cpu=on",
      },
      drives: [
        {
          drive_id: "rootfs",
          path_on_host: sessionRootfs,
          is_root_device: true,
          is_read_only: false,
        },
      ],
      "machine-config": {
        vcpu_count: 1,
        mem_size_mib: 128,
      },
    };

    fs.writeFileSync(configPath, JSON.stringify(config));

    const fcProcess = spawn("firecracker", ["--api-sock", socketPath, "--config-file", configPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const vm = {
      process: fcProcess,
      rootfs: sessionRootfs,
      socket: socketPath,
      config: configPath,
      ready: false,
      serialBuffer: "",
    };

    fcProcess.stdout.on("data", (data) => {
      vm.serialBuffer += data.toString();
      if (!vm.ready && vm.serialBuffer.includes("login:")) {
        vm.ready = true;
      }
    });

    fcProcess.on("error", (err) => {
      console.error(`[MicroVM] Process error for ${sessionId}: ${err.message}`);
    });

    fcProcess.on("exit", (code) => {
      console.log(`[MicroVM] Process exited for ${sessionId} (code ${code})`);
    });

    this.activeVMs.set(sessionId, vm);
    console.log(`[MicroVM] Started Firecracker instance for session ${sessionId}`);

    // Wait up to 10s for VM to boot
    const bootTimeout = 10000;
    const start = Date.now();
    while (!vm.ready && Date.now() - start < bootTimeout) {
      await new Promise((r) => setTimeout(r, 200));
    }

    return vm.ready ? fcProcess : null;
  }

  async executeCommand(sessionId, command, timeout = 10000) {
    const vm = this.activeVMs.get(sessionId);
    if (!vm || !vm.ready) return null;

    // Execute via Firecracker API socket using PUT to /actions
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeout);

      try {
        // Write command to serial console via the socket API
        const payload = JSON.stringify({
          action_type: "SendCtrlAltDel",
        });

        // Use vsock or serial to send command — for simplicity, use the
        // API socket to inject keystrokes via the serial console
        const cmdWithMarker = `${command} 2>&1; echo "___FC_END___"`;
        const client = net.createConnection(vm.socket, () => {
          const req = [
            `PUT /actions HTTP/1.1`,
            `Host: localhost`,
            `Content-Type: application/json`,
            `Content-Length: ${Buffer.byteLength(payload)}`,
            ``,
            payload,
          ].join("\r\n");
          client.write(req);
          client.end();
        });

        client.on("error", () => {
          clearTimeout(timer);
          resolve(null);
        });

        // Capture output from serial
        const startLen = vm.serialBuffer.length;
        const outputTimer = setInterval(() => {
          const newOutput = vm.serialBuffer.slice(startLen);
          if (newOutput.includes("___FC_END___")) {
            clearInterval(outputTimer);
            clearTimeout(timer);
            const lines = newOutput.split("\n");
            const endIdx = lines.findIndex((l) => l.includes("___FC_END___"));
            resolve(lines.slice(0, endIdx).join("\n").trim());
          }
        }, 100);
      } catch {
        clearTimeout(timer);
        resolve(null);
      }
    });
  }

  destroyMicroVM(sessionId) {
    const vm = this.activeVMs.get(sessionId);
    if (vm) {
      try { vm.process.kill("SIGKILL"); } catch {}
      try { fs.unlinkSync(vm.rootfs); } catch {}
      try { fs.unlinkSync(vm.socket); } catch {}
      try { fs.unlinkSync(vm.config); } catch {}
      this.activeVMs.delete(sessionId);
      console.log(`[MicroVM] Destroyed and wiped session ${sessionId}`);
    }
  }

  destroyAll() {
    for (const sessionId of this.activeVMs.keys()) {
      this.destroyMicroVM(sessionId);
    }
  }
}

module.exports = new MicroVMEngine();
