// Vercel Serverless Function — proxies requests to Intervals.icu API
// This avoids CORS issues when calling from the browser.
//
// Usage: GET /api/intervals?oldest=2026-04-27&newest=2026-05-03
//
// Requires environment variables set in Vercel dashboard:
//   INTERVALS_API_KEY  — your Intervals.icu API key
//   INTERVALS_ATHLETE  — your athlete ID (or "0" for authenticated user)

export default async function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.INTERVALS_API_KEY;
  const athleteId = process.env.INTERVALS_ATHLETE || '0';

  if (!apiKey) {
    return res.status(500).json({
      error: 'INTERVALS_API_KEY not configured. Add it in Vercel → Settings → Environment Variables.'
    });
  }

  const { oldest, newest, debug } = req.query;
  if (!oldest || !newest) {
    return res.status(400).json({ error: 'Missing oldest or newest query parameters (YYYY-MM-DD).' });
  }

  try {
    // Fetch activities for the date range
    const url = `https://intervals.icu/api/v1/athlete/${athleteId}/activities?oldest=${oldest}&newest=${newest}`;
    const auth = Buffer.from(`API_KEY:${apiKey}`).toString('base64');

    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: `Intervals.icu API error: ${response.status}`,
        detail: text,
        url_called: url,
        athlete_id: athleteId
      });
    }

    const activities = await response.json();

    // Debug mode: return raw API response
    if (debug === 'true') {
      return res.status(200).json({
        _debug: true,
        athlete_id: athleteId,
        url_called: url,
        activity_count: activities.length,
        activities: activities.slice(0, 10) // first 10 only
      });
    }

    // Return only the fields we need, grouped by date
    const byDate = {};
    for (const act of activities) {
      // Only cycling activities
      const type = (act.type || '').toLowerCase();
      if (!type.includes('ride') && !type.includes('cycling') && !type.includes('virtualride')) {
        continue;
      }

      // Extract date (local)
      const date = act.start_date_local
        ? act.start_date_local.slice(0, 10)
        : null;
      if (!date) continue;

      const entry = {
        id: act.id,
        name: act.name || '',
        type: act.type || '',
        date: date,
        movingTime: act.moving_time || act.elapsed_time || 0,  // seconds
        elapsedTime: act.elapsed_time || 0,
        avgWatts: act.icu_average_watts || null,  // Use ICU average power, NOT normalized (icu_weighted_avg_watts)
        normalizedWatts: act.icu_weighted_avg_watts || null,
        maxWatts: act.max_watts || null,
        // icu_joules is mechanical work; divide by 1000 → kJ ≈ kcal food energy cost
        energy: act.icu_joules ? Math.round(act.icu_joules / 1000)
              : act.calories ? Math.round(act.calories)
              : null,
        icu_training_load: act.icu_training_load || null,
        icu_intensity: act.icu_intensity || null,
        distance: act.distance || act.icu_distance || 0,
      };

      // If energy still not available, estimate from avg power × time
      if (!entry.energy && entry.avgWatts && entry.movingTime) {
        entry.energy = Math.round(entry.avgWatts * entry.movingTime / 1000);
      }

      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(entry);
    }

    // Aggregate per day (sum if multiple rides)
    const result = {};
    for (const [date, acts] of Object.entries(byDate)) {
      const totalEnergy = acts.reduce((s, a) => s + (a.energy || 0), 0);
      const totalTime = acts.reduce((s, a) => s + (a.movingTime || 0), 0);
      const powers = acts.filter(a => a.avgWatts).map(a => a.avgWatts);
      const avgPower = powers.length
        ? Math.round(powers.reduce((s, p) => s + p, 0) / powers.length)
        : null;

      result[date] = {
        date,
        rideCount: acts.length,
        totalEnergy,        // kcal
        totalTime,          // seconds
        avgWatts: avgPower,
        rides: acts
      };
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}
