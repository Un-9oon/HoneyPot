const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class MicroVMEngine {
  constructor() {
    this.vmDir = '/home/we/firecracker_vm';
    this.kernelPath = path.join(this.vmDir, 'vmlinux.bin');
    this.rootfsPath = path.join(this.vmDir, 'bionic.rootfs.ext4');
    this.activeVMs = new Map();
  }

  // Generate a unique Firecracker configuration for each attacker session
  async spawnMicroVM(sessionId) {
    const socketPath = `/tmp/firecracker-${sessionId}.socket`;
    const configPath = `/tmp/fc-config-${sessionId}.json`;
    
    // Create a copy of the rootfs for this specific session (Snapshot isolation)
    const sessionRootfs = path.join(this.vmDir, `session-${sessionId}.ext4`);
    fs.copyFileSync(this.rootfsPath, sessionRootfs);

    const config = {
      "boot-source": {
        "kernel_image_path": this.kernelPath,
        "boot_args": "console=ttyS0 reboot=k panic=1 pci=off random.trust_cpu=on"
      },
      "drives": [
        {
          "drive_id": "rootfs",
          "path_on_host": sessionRootfs,
          "is_root_device": true,
          "is_read_only": false
        }
      ],
      "machine-config": {
        "vcpu_count": 1,
        "mem_size_mib": 128
      }
    };

    fs.writeFileSync(configPath, JSON.stringify(config));

    // Spawn the Firecracker process
    const fcProcess = spawn('firecracker', [
      '--api-sock', socketPath,
      '--config-file', configPath
    ]);

    this.activeVMs.set(sessionId, { process: fcProcess, rootfs: sessionRootfs, socket: socketPath, config: configPath });

    console.log(`[MicroVM] Started isolated Firecracker instance for session ${sessionId}`);
    
    return fcProcess;
  }

  // Destroy the VM and instantly wipe the filesystem copy (State Reversion)
  destroyMicroVM(sessionId) {
    const vm = this.activeVMs.get(sessionId);
    if (vm) {
      vm.process.kill('SIGKILL');
      try { fs.unlinkSync(vm.rootfs); } catch(e) {}
      try { fs.unlinkSync(vm.socket); } catch(e) {}
      try { fs.unlinkSync(vm.config); } catch(e) {}
      this.activeVMs.delete(sessionId);
      console.log(`[MicroVM] Destroyed and wiped trace for session ${sessionId}`);
    }
  }
}

module.exports = new MicroVMEngine();
