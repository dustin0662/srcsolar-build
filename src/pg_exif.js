/* pg_exif.js — minimal JPEG/EXIF reader for the photogrammetry tool.
   Pulls out what the reconstruction actually needs: focal length (in pixels),
   camera make/model, capture time, orientation and GPS. Also scans the XMP
   packet for the drone fields DJI and Autel write (relative altitude, gimbal
   angles), which are useful for georeferencing a site flight. */

const UNIT_MM = { 1: null, 2: 25.4, 3: 10, 4: 1 };

function readTiff(view, tiffStart) {
  const b0 = view.getUint16(tiffStart, false);
  if (b0 !== 0x4949 && b0 !== 0x4d4d) return null;
  const le = b0 === 0x4949;
  if (view.getUint16(tiffStart + 2, le) !== 42) return null;
  return { le: le, start: tiffStart, ifd0: tiffStart + view.getUint32(tiffStart + 4, le) };
}

function readValue(view, tiffStart, le, type, count, valueOffset) {
  const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  const size = sizes[type] || 1;
  const total = size * count;
  let off = valueOffset;
  if (total > 4) off = tiffStart + view.getUint32(valueOffset, le);
  if (off + total > view.byteLength) return null;
  const out = [];
  for (let i = 0; i < count; i++) {
    const p = off + i * size;
    switch (type) {
      case 1: case 7: out.push(view.getUint8(p)); break;
      case 2: out.push(String.fromCharCode(view.getUint8(p))); break;
      case 3: out.push(view.getUint16(p, le)); break;
      case 4: out.push(view.getUint32(p, le)); break;
      case 5: { const n = view.getUint32(p, le), d = view.getUint32(p + 4, le); out.push(d ? n / d : 0); break; }
      case 6: out.push(view.getInt8(p)); break;
      case 8: out.push(view.getInt16(p, le)); break;
      case 9: out.push(view.getInt32(p, le)); break;
      case 10: { const n = view.getInt32(p, le), d = view.getInt32(p + 4, le); out.push(d ? n / d : 0); break; }
      case 11: out.push(view.getFloat32(p, le)); break;
      case 12: out.push(view.getFloat64(p, le)); break;
      default: out.push(0);
    }
  }
  if (type === 2) return out.join('').replace(/\0+$/, '');
  return count === 1 ? out[0] : out;
}

function readIFD(view, tiff, offset, into) {
  if (offset + 2 > view.byteLength) return;
  const n = view.getUint16(offset, tiff.le);
  if (n > 512) return;
  for (let i = 0; i < n; i++) {
    const e = offset + 2 + i * 12;
    if (e + 12 > view.byteLength) return;
    const tag = view.getUint16(e, tiff.le);
    const type = view.getUint16(e + 2, tiff.le);
    const count = view.getUint32(e + 4, tiff.le);
    if (count > 65535) continue;
    try { into[tag] = readValue(view, tiff.start, tiff.le, type, count, e + 8); } catch (err) { /* skip bad tag */ }
  }
}

function dms(v, ref) {
  if (!Array.isArray(v) || v.length < 3) return null;
  const d = v[0] + v[1] / 60 + v[2] / 3600;
  return (ref === 'S' || ref === 'W') ? -d : d;
}

/* Parse a JPEG (or bare TIFF/DNG) buffer. Never throws — returns {} when
   there is nothing readable. */
export function parseExif(buffer) {
  const out = {};
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 16) return out;
    let tiff = null, xmp = '';
    if (view.getUint16(0, false) === 0xffd8) {          // JPEG
      let p = 2;
      while (p + 4 < view.byteLength) {
        if (view.getUint8(p) !== 0xff) { p++; continue; }
        const marker = view.getUint8(p + 1);
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
        if (marker === 0xda || marker === 0xd9) break;   // start of scan
        const len = view.getUint16(p + 2, false);
        if (len < 2) break;
        if (marker === 0xe1) {
          let sig = '';
          for (let i = 0; i < 6 && p + 4 + i < view.byteLength; i++) sig += String.fromCharCode(view.getUint8(p + 4 + i));
          if (sig === 'Exif\0\0' && !tiff) tiff = readTiff(view, p + 10);
          else if (sig.slice(0, 4) === 'http') {
            const bytes = new Uint8Array(buffer, p + 4, Math.min(len - 2, view.byteLength - p - 4));
            xmp += new TextDecoder('utf-8', { fatal: false }).decode(bytes);
          }
        }
        p += 2 + len;
      }
    } else tiff = readTiff(view, 0);                    // TIFF / DNG

    if (tiff) {
      const ifd0 = {}, exif = {}, gps = {};
      readIFD(view, tiff, tiff.ifd0, ifd0);
      if (ifd0[0x8769]) readIFD(view, tiff, tiff.start + ifd0[0x8769], exif);
      if (ifd0[0x8825]) readIFD(view, tiff, tiff.start + ifd0[0x8825], gps);
      out.make = ifd0[0x010f] || undefined;
      out.model = ifd0[0x0110] || undefined;
      out.orientation = ifd0[0x0112] || 1;
      out.dateTime = exif[0x9003] || ifd0[0x0132] || undefined;
      out.exifWidth = exif[0xa002] || ifd0[0x0100] || undefined;
      out.exifHeight = exif[0xa003] || ifd0[0x0101] || undefined;
      if (typeof exif[0x920a] === 'number') out.focalMm = exif[0x920a];
      if (typeof exif[0xa405] === 'number') out.focal35 = exif[0xa405];
      if (typeof exif[0xa20e] === 'number') out.focalPlaneXRes = exif[0xa20e];
      if (typeof exif[0xa210] === 'number') out.focalPlaneUnit = exif[0xa210];
      const lat = dms(gps[2], gps[1]), lon = dms(gps[4], gps[3]);
      if (lat != null && lon != null && isFinite(lat) && isFinite(lon)) {
        out.lat = lat; out.lon = lon;
        if (typeof gps[6] === 'number') out.alt = gps[5] === 1 ? -gps[6] : gps[6];
      }
    }

    if (xmp) {
      const grab = (name) => {
        const m = xmp.match(new RegExp(name + '\\s*=\\s*"([^"]*)"')) || xmp.match(new RegExp('<' + name + '>([^<]*)<'));
        if (!m) return undefined;
        const v = parseFloat(String(m[1]).replace(/^\+/, ''));
        return isFinite(v) ? v : undefined;
      };
      const rel = grab('drone-dji:RelativeAltitude');
      const abs = grab('drone-dji:AbsoluteAltitude');
      if (rel !== undefined) out.relativeAltitude = rel;
      if (abs !== undefined && out.alt === undefined) out.alt = abs;
      const gy = grab('drone-dji:GimbalYawDegree'), gp = grab('drone-dji:GimbalPitchDegree');
      if (gy !== undefined) out.gimbalYaw = gy;
      if (gp !== undefined) out.gimbalPitch = gp;
      if (out.lat === undefined) {
        const la = grab('drone-dji:GpsLatitude') ?? grab('drone-dji:Latitude');
        const lo = grab('drone-dji:GpsLongitude') ?? grab('drone-dji:Longtitude') ?? grab('drone-dji:GpsLongtitude');
        if (la !== undefined && lo !== undefined) { out.lat = la; out.lon = lo; }
      }
    }
  } catch (e) { /* corrupt header — fall back to defaults */ }
  return out;
}

/* Focal length in pixels for an image decoded at width×height.
   Returns { f, source } where source explains which EXIF path was used, or
   null when EXIF carries nothing usable. */
export function focalPixels(exif, width, height) {
  const longSide = Math.max(width, height);
  if (!exif) return null;
  if (exif.focal35 > 0) return { f: exif.focal35 * longSide / 36, source: '35mm equivalent ' + exif.focal35 + 'mm' };
  if (exif.focalMm > 0 && exif.focalPlaneXRes > 0) {
    const unit = UNIT_MM[exif.focalPlaneUnit || 2];
    if (unit) {
      const sensorW = (exif.exifWidth || longSide) / exif.focalPlaneXRes * unit;
      if (sensorW > 1 && sensorW < 100) return { f: exif.focalMm / sensorW * longSide, source: exif.focalMm + 'mm on a ' + sensorW.toFixed(1) + 'mm sensor' };
    }
  }
  if (exif.focalMm > 0) {
    // no sensor size: assume a 1/2.3"–APS-C-ish crop is unknowable, so guess a
    // common 6.3mm-wide compact/drone sensor only when the value is plausible
    const sensorW = 6.3;
    if (exif.focalMm > 1 && exif.focalMm < 200) return { f: exif.focalMm / sensorW * longSide, source: exif.focalMm + 'mm, sensor width assumed ' + sensorW + 'mm' };
  }
  return null;
}

/* default focal when EXIF is silent: ~62° horizontal field of view */
export function defaultFocal(width, height) {
  return 0.85 * Math.max(width, height);
}

/* WGS-84 → local east/north/up metres about a reference lat/lon/alt */
export function gpsToEnu(lat, lon, alt, ref) {
  const D = Math.PI / 180;
  const a = 6378137.0, e2 = 6.69437999014e-3;
  const sLat = Math.sin(ref.lat * D), cLat = Math.cos(ref.lat * D);
  const N = a / Math.sqrt(1 - e2 * sLat * sLat);
  const mPerDegLat = (Math.PI / 180) * (a * (1 - e2)) / Math.pow(1 - e2 * sLat * sLat, 1.5);
  const mPerDegLon = (Math.PI / 180) * N * cLat;
  return [
    (lon - ref.lon) * mPerDegLon,
    (lat - ref.lat) * mPerDegLat,
    (alt || 0) - (ref.alt || 0),
  ];
}
