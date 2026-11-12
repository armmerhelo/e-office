/*
 * Shared geometry for the e-sign v2 drawing layer.
 * Plain UMD so the browser can load it as a classic script and Node tests can
 * require it without a build step.
 */
(function (root) {
    'use strict';

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function distanceToSegment(px, py, ax, ay, bx, by) {
        const dx = bx - ax;
        const dy = by - ay;
        if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
        const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
        return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }

    // Ramer-Douglas-Peucker for flat [x, y] arrays.
    function simplifyRdp(points, tolerance) {
        if (!Array.isArray(points) || points.length < 3 || tolerance <= 0) return points ? points.slice() : [];
        const keep = new Uint8Array(points.length);
        keep[0] = 1;
        keep[points.length - 1] = 1;
        const stack = [[0, points.length - 1]];
        while (stack.length) {
            const [first, last] = stack.pop();
            let maxDistance = 0;
            let index = -1;
            for (let i = first + 1; i < last; i++) {
                const distance = distanceToSegment(
                    points[i][0], points[i][1],
                    points[first][0], points[first][1],
                    points[last][0], points[last][1]
                );
                if (distance > maxDistance) {
                    maxDistance = distance;
                    index = i;
                }
            }
            if (index !== -1 && maxDistance > tolerance) {
                keep[index] = 1;
                stack.push([first, index], [index, last]);
            }
        }
        return points.filter((_, index) => keep[index]);
    }

    // Expand the quadratic midpoint curve used on screen into line segments.
    // The result keeps the same visual shape when flattened into a PDF path.
    function smoothStroke(points, subdivisions) {
        const steps = Math.max(1, subdivisions || 4);
        if (!Array.isArray(points) || points.length === 0) return [];
        if (points.length === 1) return [points[0].slice()];
        if (points.length === 2) return [points[0].slice(), points[1].slice()];
        const output = [points[0].slice()];
        for (let i = 1; i < points.length - 1; i++) {
            const control = points[i];
            const start = i === 1
                ? points[0]
                : [(points[i - 1][0] + control[0]) / 2, (points[i - 1][1] + control[1]) / 2];
            const end = [(control[0] + points[i + 1][0]) / 2, (control[1] + points[i + 1][1]) / 2];
            for (let step = 1; step <= steps; step++) {
                const t = step / steps;
                const mt = 1 - t;
                output.push([
                    mt * mt * start[0] + 2 * mt * t * control[0] + t * t * end[0],
                    mt * mt * start[1] + 2 * mt * t * control[1] + t * t * end[1]
                ]);
            }
        }
        output.push(points[points.length - 1].slice());
        return output;
    }

    function strokeHit(points, nx, ny, baseWidth, baseHeight, radius) {
        if (!Array.isArray(points) || points.length === 0) return false;
        const x = nx * baseWidth;
        const y = ny * baseHeight;
        if (points.length === 1) {
            return Math.hypot(x - points[0][0] * baseWidth, y - points[0][1] * baseHeight) <= radius;
        }
        for (let i = 1; i < points.length; i++) {
            if (distanceToSegment(
                x, y,
                points[i - 1][0] * baseWidth, points[i - 1][1] * baseHeight,
                points[i][0] * baseWidth, points[i][1] * baseHeight
            ) <= radius) return true;
        }
        return false;
    }

    function uid(prefix) {
        return (prefix || 'a') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    const api = { clamp, distanceToSegment, simplifyRdp, smoothStroke, strokeHit, uid };
    root.EsignGeometry = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
