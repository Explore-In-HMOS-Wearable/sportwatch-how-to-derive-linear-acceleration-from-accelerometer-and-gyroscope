import sensor from '@system.sensor';
import vibrator from '@system.vibrator';

let running = false;
let detected = false;

const ALPHA = 0.98;
const FALL_THRESHOLD = 25.0;

let gravity = { x: 0, y: 0, z: 9.8 };
let gyroDrift = { x: 0, y: 0, z: 0 };
let lastGyroTime = 0;

export default {
  data: {
    accText: '0.0, 0.0, 0.0',
    gyroText: '0.0, 0.0, 0.0',
    linAccText: '0.0, 0.0, 0.0',
    gravityText: '0.0, 0.0, 0.0',
    statusText: 'Stopped',
    btnText: 'Start',
    alertVisible: false
  },
  onInit() {
  },
  onReady() {
  },
  vibrate() {
    try {
      let vibrateOptions = {
        mode: 'short',
        success: () => {
          console.info('Succeeded in vibrating');
        },
        fail: (data, code) => {
          console.error(`Failed to vibrate. Data: ${data}, code: ${code}`);
        },
        complete: () => {
          console.info('vibration completed');
        }
      };
      vibrator.vibrate(vibrateOptions);
    } catch (e) {
    }
  },
  onDestroy() {
    this.stopMonitoring();
  },
  normalize(v) {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (len === 0) {
      return v;
    }
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  },
  cross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  },
  dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  },
  updateGravityWithAccel(rawAcc) {
    const accNorm = this.normalize(rawAcc);
    const gravNorm = this.normalize(gravity);
    const cosAngle = Math.max(-1, Math.min(1, this.dot(accNorm, gravNorm)));
    const angle = Math.acos(cosAngle);
    if (angle < 0.01) {
      return gravity;
    }
    const axis = this.normalize(this.cross(gravNorm, accNorm));
    const sinHalf = Math.sin(angle * 0.5);
    const cosHalf = Math.cos(angle * 0.5);
    const q = {
      x: axis.x * sinHalf,
      y: axis.y * sinHalf,
      z: axis.z * sinHalf,
      w: cosHalf
    };
    const qConj = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
    const gravQuat = { x: gravity.x, y: gravity.y, z: gravity.z, w: 0 };
    const qGrav = this.quatMult(this.quatMult(q, gravQuat), qConj);
    const correction = 0.1;
    gravity.x += (qGrav.x - gravity.x) * correction;
    gravity.y += (qGrav.y - gravity.y) * correction;
    gravity.z += (qGrav.z - gravity.z) * correction;
    const gNorm = this.normalize(gravity);
    const mag = Math.sqrt(rawAcc.x * rawAcc.x + rawAcc.y * rawAcc.y + rawAcc.z * rawAcc.z);
    gravity.x = gNorm.x * mag;
    gravity.y = gNorm.y * mag;
    gravity.z = gNorm.z * mag;
    return gravity;
  },
  quatMult(a, b) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
    };
  },
  updateGravityWithGyro(rawGyro, dt) {
    if (dt <= 0) {
       return gravity;
    }
    const halfDt = dt * 0.5;
    const normGyro = this.normalize(rawGyro);
    const qDot = {
      x: normGyro.x * halfDt,
      y: normGyro.y * halfDt,
      z: normGyro.z * halfDt,
      w: 1
    };
    const gravQuat = this.eulerToQuat(rawGyro.x * halfDt, rawGyro.y * halfDt, rawGyro.z * halfDt);
    const newGravQuat = this.quatMult(gravQuat, { x: gravity.x, y: gravity.y, z: gravity.z, w: 0 });
    gravity.x += qDot.x * 0.1;
    gravity.y += qDot.y * 0.1;
    gravity.z += qDot.z * 0.1;
    return gravity;
  },
  eulerToQuat(rx, ry, rz) {
    const sx = Math.sin(rx), cx = Math.cos(rx);
    const sy = Math.sin(ry), cy = Math.cos(ry);
    const sz = Math.sin(rz), cz = Math.cos(rz);
    return {
      x: sx * cy * cz - cx * sy * sz,
      y: cx * sy * cz + sx * cy * sz,
      z: cx * cy * sz - sx * sy * cz,
      w: cx * cy * cz + sx * sy * sz
    };
  },
  applyComplementaryFilter(rawAcc, rawGyro, dt) {
    gravity = this.updateGravityWithGyro(rawGyro, dt);
    gravity = this.updateGravityWithAccel(rawAcc);
    return gravity;
  },
  computeLinearAcceleration(rawAcc, grav) {
    return {
      x: rawAcc.x - grav.x,
      y: rawAcc.y - grav.y,
      z: rawAcc.z - grav.z
    };
  },
  onAccelData(data) {
    const rawAcc = { x: data.x, y: data.y, z: data.z };
    this.accText = `${rawAcc.x.toFixed(2)}, ${rawAcc.y.toFixed(2)}, ${rawAcc.z.toFixed(2)}`;
    if (!running) {
      return;
    }
    this.applyComplementaryFilter(rawAcc, { x: 0, y: 0, z: 0 }, 0.02);
    const linAcc = this.computeLinearAcceleration(rawAcc, gravity);
    this.linAccText = `${linAcc.x.toFixed(2)}, ${linAcc.y.toFixed(2)}, ${linAcc.z.toFixed(2)}`
    this.gravityText = `${gravity.x.toFixed(2)}, ${gravity.y.toFixed(2)}, ${gravity.z.toFixed(2)}`
    const linMag = Math.sqrt(linAcc.x * linAcc.x + linAcc.y * linAcc.y + linAcc.z * linAcc.z);
    if (linMag > FALL_THRESHOLD && !detected) {
      detected = true;
      this.statusText = 'Fall Detected!';
      this.alertVisible = true;
      this.playAlert();
    }
  },
  onGyroData(data) {
    const rawGyro = { x: data.x, y: data.y, z: data.z };
    this.gyroText = `${rawGyro.x.toFixed(3)}, ${rawGyro.y.toFixed(3)}, ${rawGyro.z.toFixed(3)}`;
    if (!running) {
      return;
    }
    const now = Date.now();
    const dt = lastGyroTime > 0 ? (now - lastGyroTime) / 1000 : 0.02;
    lastGyroTime = now;
    this.applyComplementaryFilter({ x: 0, y: 0, z: 9.8 }, rawGyro, dt);
  },
  playAlert() {
   this.vibrate();
  },
  startMonitoring() {
    if (running) {
      return;
    }
    running = true;
    detected = false;
    gravity = { x: 0, y: 0, z: 9.8 };
    lastGyroTime = 0;
    this.statusText = 'Monitoring';
    this.btnText = 'Stop';
    this.alertVisible = false;
    try {
      sensor.subscribeAccelerometer({
        interval: "normal",
        success: (data) => {
          this.onAccelData(data)
        },
        fail: (data, code) => {
        }
      })
      sensor.subscribeGyroscope({
        interval: "normal",
        success: (data) => {
          this.onGyroData(data)
        },
        fail: (data, code) => {
        }
      })
    } catch (err) {
      running = false;
      this.btnText = 'Start';
    }
  },
  stopMonitoring() {
    if (!running) {
      return;
    }
    running = false;
    this.statusText = 'Stopped';
    this.btnText = 'Start';
    try {
      sensor.unsubscribeGyroscope();
      sensor.unsubscribeAccelerometer();
    } catch (err) {
    }
  },
  toggleMonitoring() {
    if (running) {
      this.stopMonitoring();
    } else {
      this.startMonitoring();
    }
  },
  dismissAlert() {
    detected = false;
    this.alertVisible = false;
    this.statusText = running ? 'Monitoring' : 'Stopped';
  }
};
