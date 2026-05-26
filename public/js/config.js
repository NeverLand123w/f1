const _urlParams = new URLSearchParams(window.location.search);
const _trackId = _urlParams.get('track') || 'portugal';
const _urlLaps = parseInt(_urlParams.get('laps')) || 15;

const TOTAL_LAPS = _urlLaps, NUM_CARS = 22;
const WORLD_SCALE = 3000;
const TRACK_WIDTH_PX = 48, CAR_LENGTH = 20, CAR_WIDTH = 11;
const MAX_BASE_SPEED = 0.00205, PIT_SPEED_LIMIT = MAX_BASE_SPEED * (80 / 335), CAR_SPACE_FRAC = 0.011;
const SC_PACE_SPEED = MAX_BASE_SPEED * 0.30;
const VSC_PACE_SPEED = MAX_BASE_SPEED * 0.45;
const UPSHIFT_SPEEDS = [0, 80, 120, 160, 200, 245, 280, 315, 360], DOWNSHIFT_SPEEDS = [0, 55, 95, 135, 175, 215, 255, 290];

const F1_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

const BUMP_ZONES = [
    { frac: 0.12, intensity: 0.7, label: 'T1 Kerb' },
    { frac: 0.28, intensity: 0.5, label: 'Chicane' },
    { frac: 0.55, intensity: 0.4, label: 'S Bends' },
    { frac: 0.72, intensity: 0.8, label: 'T12 Curb' },
    { frac: 0.88, intensity: 0.3, label: 'Pit Exit' },
];

const AERO = { downforceBase: 0.00000045, dragBase: 0.00000012, porpoisingThreshold: 280, stallSpeed: 180 };
const PACEJKA = { B: 6.5, C: 1.9, D: 1.0, E: -1.5 };
const AI_EMOTIONS = ['neutral', 'panic', 'frustration', 'confidence', 'aggro'];

const TYRES = {
    SOFT: { label: 'SOFT', abbr: 'S', bg: '#E8002D', dur: 5, gripBonus: 0.08, degradeMult: 2.3, idealWet: 0.0, wetPen: 2.2, optTemp: 100, tempRange: 15 },
    MEDIUM: { label: 'MEDIUM', abbr: 'M', bg: '#DDDD00', dur: 8, gripBonus: 0.03, degradeMult: 1.2, idealWet: 0.0, wetPen: 2.2, optTemp: 110, tempRange: 15 },
    HARD: { label: 'HARD', abbr: 'H', bg: '#DDDDDD', dur: 12, gripBonus: 0.0, degradeMult: 0.7, idealWet: 0.0, wetPen: 2.2, optTemp: 115, tempRange: 15 },
    INTER: { label: 'INTER', abbr: 'I', bg: 'var(--inter)', dur: 10, gripBonus: 0.02, degradeMult: 1.2, idealWet: 0.35, wetPen: 0.8, optTemp: 80, tempRange: 15 },
    WET: { label: 'WET', abbr: 'W', bg: 'var(--wet)', dur: 14, gripBonus: 0.0, degradeMult: 0.8, idealWet: 0.80, wetPen: 0.4, optTemp: 70, tempRange: 15 }
};

const CASCADE_CHAINS = {
    hydraulic: ['⚡ HYDRAULIC PRESSURE DROP', '⚠ BRAKE BALANCE SHIFTING', '🔴 POWER STEERING LOST', '💀 HYDRAULIC TOTAL FAILURE'],
    gearbox: ['⚡ GEARBOX VIBRATION', '⚠ GEAR SLIP DETECTED', '🔴 GEAR ENGAGEMENT LOSS', '💀 GEARBOX FAILURE - DNF'],
    thermal: ['⚡ COOLANT TEMP RISING', '⚠ ENGINE OVERHEATING', '🔴 POWER MODE LIMITED', '💀 ENGINE BLOW - DNF'],
};

const F1_TEAMS = [
    { name: 'Red Bull', c: '#3671C6', h: '#FFD700' }, // 0
    { name: 'Ferrari', c: '#E8002D', h: '#FFFFFF' }, // 1
    { name: 'Mercedes', c: '#27F4D2', h: '#FFFFFF' }, // 2
    { name: 'McLaren', c: '#FF8000', h: '#000000' }, // 3
    { name: 'Aston Martin', c: '#229971', h: '#FFFFFF' }, // 4
    { name: 'Alpine', c: '#0093CC', h: '#FF0000' }, // 5
    { name: 'Williams', c: '#64C4FF', h: '#FFFFFF' }, // 6
    { name: 'Haas', c: '#B6BABD', h: '#E8002D' }, // 7
    { name: 'Racing Bulls', c: '#6692FF', h: '#FFFFFF' }, // 8
    { name: 'Audi', c: '#6BFF6B', h: '#000000' }, // 9 
    { name: 'Cadillac', c: '#FFFFFF', h: '#C8A951' }, // 10
];

let DRIVER_DB = [
    { n: 'Verstappen', t: 0, s: 0.99, a: 0.97 },
    { n: 'Pérez', t: 10, s: 0.89, a: 0.85 },
    { n: 'Leclerc', t: 1, s: 0.97, a: 0.92 },
    { n: 'Sainz', t: 6, s: 0.93, a: 0.86 },
    { n: 'Hamilton', t: 1, s: 0.95, a: 0.87 },
    { n: 'Russell', t: 2, s: 0.93, a: 0.90 },
    { n: 'Norris', t: 3, s: 0.96, a: 0.92 },
    { n: 'Piastri', t: 3, s: 0.92, a: 0.84 },
    { n: 'Alonso', t: 4, s: 0.94, a: 0.98 },
    { n: 'Stroll', t: 4, s: 0.83, a: 0.88 },
    { n: 'Gasly', t: 5, s: 0.85, a: 0.85 },
    { n: 'Ocon', t: 7, s: 0.85, a: 0.89 },
    { n: 'Albon', t: 6, s: 0.87, a: 0.81 },
    { n: 'Hülkenberg', t: 9, s: 0.84, a: 0.82 },
    { n: 'Bottas', t: 10, s: 0.83, a: 0.75 },
    { n: 'Antonelli', t: 2, s: 0.88, a: 0.83 },
    { n: 'Hadjar', t: 0, s: 0.84, a: 0.80 },
    { n: 'Colapinto', t: 5, s: 0.87, a: 0.84 },
    { n: 'Lawson', t: 8, s: 0.86, a: 0.85 },
    { n: 'Lindblad', t: 8, s: 0.83, a: 0.80 },
    { n: 'Bearman', t: 7, s: 0.86, a: 0.82 },
    { n: 'Bortoleto', t: 9, s: 0.85, a: 0.81 }
];

const TRACK_DB = {
    portugal: {
        name: 'PORTUGUESE GRAND PRIX', city: 'Portimão',
        raw: [[0.75, 0.80], [0.55, 0.80], [0.35, 0.80], [0.20, 0.78], [0.1, 0.68], [0.1, 0.58], [0.1, 0.4], [0.20, 0.38], [0.33, 0.5], [0.206, 0.65], [0.26, 0.70], [0.45, 0.56], [0.65, 0.42], [0.7, 0.32], [0.65, 0.26], [0.5, 0.3], [0.4, 0.3], [0.3, 0.3], [0.1, 0.1], [0.25, 0], [0.4, 0.20], [0.60, 0.16], [0.70, 0.16], [0.8, 0.15], [0.86, 0.22], [0.9, 0.35], [0.94, 0.55], [0.88, 0.72]],
        drs: [{ s: 0.94, e: 0.08 }, { s: 0.35, e: 0.45 }], scaleY: 1.1
    },
    monaco: {
        name: 'MONACO GRAND PRIX', city: 'Monte Carlo',
        raw: [[0.50, 0.85], [0.35, 0.85], [0.18, 0.82], [0.08, 0.70], [0.08, 0.55], [0.12, 0.42], [0.20, 0.35], [0.28, 0.28], [0.22, 0.18], [0.30, 0.10], [0.44, 0.08], [0.55, 0.12], [0.60, 0.22], [0.55, 0.30], [0.48, 0.32], [0.62, 0.38], [0.72, 0.32], [0.78, 0.22], [0.88, 0.18], [0.92, 0.28], [0.90, 0.42], [0.82, 0.52], [0.88, 0.62], [0.88, 0.74], [0.80, 0.82], [0.68, 0.85]],
        drs: [{ s: 0.78, e: 0.88 }], scaleY: 1.05
    },
    silverstone: {
        name: 'BRITISH GRAND PRIX', city: 'Silverstone',
        raw: [[0.80, 0.75], [0.65, 0.82], [0.48, 0.82], [0.30, 0.78], [0.15, 0.70], [0.08, 0.56], [0.10, 0.42], [0.18, 0.32], [0.28, 0.25], [0.38, 0.20], [0.50, 0.18], [0.62, 0.15], [0.72, 0.18], [0.80, 0.25], [0.85, 0.35], [0.88, 0.48], [0.90, 0.60], [0.88, 0.70]],
        drs: [{ s: 0.05, e: 0.18 }, { s: 0.52, e: 0.62 }], scaleY: 1.0
    },
    monza: {
        name: 'ITALIAN GRAND PRIX', city: 'Monza',
        raw: [[0.72, 0.80], [0.55, 0.82], [0.38, 0.80], [0.22, 0.72], [0.14, 0.60], [0.14, 0.46], [0.20, 0.36], [0.30, 0.28], [0.42, 0.22], [0.55, 0.18], [0.65, 0.14], [0.74, 0.10], [0.82, 0.14], [0.88, 0.22], [0.92, 0.32], [0.90, 0.46], [0.86, 0.58], [0.88, 0.68], [0.85, 0.76]],
        drs: [{ s: 0.90, e: 0.05 }, { s: 0.45, e: 0.55 }], scaleY: 1.0
    },
    spa: {
        name: 'BELGIAN GRAND PRIX', city: 'Spa-Francorchamps',
        raw: [[0.70, 0.85], [0.52, 0.85], [0.35, 0.80], [0.20, 0.72], [0.10, 0.62], [0.08, 0.48], [0.12, 0.35], [0.18, 0.24], [0.25, 0.15], [0.35, 0.08], [0.48, 0.05], [0.60, 0.08], [0.68, 0.15], [0.72, 0.25], [0.78, 0.18], [0.86, 0.15], [0.92, 0.22], [0.95, 0.35], [0.94, 0.50], [0.88, 0.62], [0.90, 0.72], [0.84, 0.80]],
        drs: [{ s: 0.92, e: 0.06 }, { s: 0.48, e: 0.58 }], scaleY: 1.1
    },
    suzuka: {
        name: 'JAPANESE GRAND PRIX', city: 'Suzuka',
        raw: [[0.68, 0.82], [0.52, 0.85], [0.36, 0.82], [0.22, 0.75], [0.12, 0.62], [0.10, 0.48], [0.14, 0.35], [0.22, 0.26], [0.30, 0.20], [0.38, 0.16], [0.45, 0.12], [0.52, 0.10], [0.60, 0.12], [0.66, 0.18], [0.70, 0.26], [0.65, 0.34], [0.56, 0.38], [0.52, 0.48], [0.58, 0.55], [0.68, 0.55], [0.76, 0.50], [0.82, 0.42], [0.88, 0.32], [0.90, 0.22], [0.88, 0.12], [0.94, 0.08], [0.96, 0.22], [0.94, 0.38], [0.92, 0.52], [0.90, 0.62], [0.88, 0.72], [0.82, 0.78]],
        drs: [{ s: 0.88, e: 0.02 }, { s: 0.40, e: 0.50 }], scaleY: 1.0
    },
    bahrain: {
        name: 'BAHRAIN GRAND PRIX', city: 'Sakhir',
        raw: [[0.70, 0.78], [0.54, 0.82], [0.38, 0.80], [0.24, 0.72], [0.14, 0.60], [0.10, 0.46], [0.12, 0.32], [0.20, 0.22], [0.30, 0.14], [0.42, 0.10], [0.54, 0.10], [0.64, 0.14], [0.72, 0.20], [0.76, 0.28], [0.82, 0.22], [0.88, 0.18], [0.92, 0.26], [0.94, 0.38], [0.92, 0.50], [0.88, 0.60], [0.84, 0.68]],
        drs: [{ s: 0.90, e: 0.05 }, { s: 0.38, e: 0.48 }, { s: 0.58, e: 0.66 }], scaleY: 1.05
    },
    miami: {
        name: 'MIAMI GRAND PRIX', city: 'Miami Gardens',
        raw: [[0.72, 0.80], [0.56, 0.82], [0.40, 0.80], [0.26, 0.74], [0.16, 0.62], [0.10, 0.50], [0.10, 0.36], [0.16, 0.24], [0.26, 0.16], [0.38, 0.10], [0.50, 0.08], [0.62, 0.10], [0.72, 0.16], [0.80, 0.22], [0.86, 0.30], [0.90, 0.40], [0.90, 0.52], [0.86, 0.62], [0.82, 0.70], [0.88, 0.74], [0.90, 0.82], [0.82, 0.85]],
        drs: [{ s: 0.88, e: 0.02 }, { s: 0.44, e: 0.54 }, { s: 0.64, e: 0.72 }], scaleY: 1.0
    }
};

const _activeTrack = TRACK_DB[_trackId] || TRACK_DB['portugal'];
const DRS_ZONES = _activeTrack.drs;