/**
 * The room the demo scans: an L-shaped kitchen, in the real `mozu.roomscan/1`
 * wire format — byte-identical to what the Swift app's `RoomScan.jsonData()`
 * emits.
 *
 * Deliberately not a rectangle with one socket. An L-shape exercises the wall
 * indexing (six walls, two of them short), and the fixture list covers every
 * type the conflict engine treats differently: sockets at worktop height, a
 * switch, water and waste for the sink, and a gas point that carries its own
 * larger clearance. A demo that only proves the easy case proves very little.
 */
window.MOZU_DEMO_ROOM = {
  schema: 'mozu.roomscan/1',
  // L-shape, millimetres, clockwise from the top-left corner.
  polygon: [
    { x: 0, z: 0 },
    { x: 4600, z: 0 },
    { x: 4600, z: 2400 },
    { x: 2800, z: 2400 },
    { x: 2800, z: 3600 },
    { x: 0, z: 3600 },
  ],
  height: 2500,
  openings: [
    { type: 'door', wall: 4, offset: 1500, width: 850, height: 2030, sill: 0 },
    { type: 'window', wall: 5, offset: 1100, width: 1400, height: 1200, sill: 900 },
  ],
  objects: [],
  fixtures: [
    // Run of sockets above the worktop on the long wall.
    { type: 'socket', wall: 0, offset: 1150, height: 1100, source: 'detected', confidence: 0.94 },
    { type: 'socket', wall: 0, offset: 1900, height: 1100, source: 'detected', confidence: 0.91 },
    // Sink services, same wall, low down.
    { type: 'water', wall: 0, offset: 3250, height: 450, source: 'detected', confidence: 0.86, diameterMm: 15 },
    { type: 'waste', wall: 0, offset: 3400, height: 300, source: 'detected', confidence: 0.83, diameterMm: 110 },
    // One the detector missed and the surveyor pinned by hand.
    { type: 'socket', wall: 1, offset: 850, height: 1100, source: 'manual', confidence: 1 },
    // A switch by the door, and the hob's gas point.
    { type: 'switch', wall: 5, offset: 320, height: 1350, source: 'detected', confidence: 0.88 },
    { type: 'gas', wall: 4, offset: 850, height: 400, source: 'detected', confidence: 0.9, diameterMm: 22 },
  ],
  source: 'roomplan',
  unitSystem: 'metric',
  confidence: 0.93,
  capturedAt: new Date().toISOString(),
};
