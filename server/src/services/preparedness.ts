import { depthClass, magnitudeClass, type PreparednessPackage, type QuakeEvent } from '../../../shared/types';

/**
 * Generated locally from the USGS record plus fixed, general preparedness guidance.
 * No AI and no external calls: this is the benefit unlocked by the verified sandbox purchase.
 */
export function buildPreparednessPackage(e: QuakeEvent): PreparednessPackage {
  const ctx: string[] = [];
  if (e.magnitude !== null) {
    ctx.push(`USGS reports magnitude ${e.magnitude.toFixed(1)}, which falls in the USGS "${magnitudeClass(e.magnitude)}" class. Magnitude measures energy release, not damage: effects depend on distance, depth, local geology and construction.`);
  } else ctx.push('USGS did not report a magnitude for this event.');
  const dc = depthClass(e.depthKm);
  if (dc && e.depthKm !== null) ctx.push(`Depth is ${e.depthKm.toFixed(1)} km, a ${dc} event by the usual seismological split (under 70 km shallow, 70-300 km intermediate, deeper than 300 km deep). Shallow events tend to produce stronger shaking near the epicentre than deeper ones of the same magnitude.`);
  if (e.felt !== null) ctx.push(`${e.felt} "Did You Feel It?" report(s) had been submitted to USGS when this data was retrieved.`);
  ctx.push('This feed does not report casualties, damage or affected populations. Those details are unknown here.');

  return {
    eventId: e.id,
    title: 'Enhanced Preparedness Briefing',
    eventContext: { heading: `Event context: ${e.place ?? e.title}`, points: ctx },
    sections: [
      { heading: 'Before an earthquake', items: [
        'Make a household plan: where to meet, who calls whom, and an out-of-area contact everyone can reach.',
        'Prepare a go-bag: water, food for several days, torch, radio, first-aid kit, medications, copies of key documents, phone charger/power bank.',
        'Secure heavy furniture, shelves and water heaters to walls; keep heavy items on low shelves.',
        'Learn where your gas, water and electricity shut-offs are and ask your utility how to use them safely.',
        'Practise "Drop, Cover, Hold On" with everyone in your household.',
      ] },
      { heading: 'During shaking (general guidance)', items: [
        'Drop to your hands and knees, take cover under a sturdy table or against an interior wall away from windows, and hold on until the shaking stops.',
        'If you are in bed, stay there and protect your head with a pillow.',
        'If you are outdoors, move away from buildings, streetlights and utility wires.',
        'If you are driving, pull over somewhere clear of bridges, overpasses and wires, and stay in the vehicle.',
      ] },
      { heading: 'After an earthquake', items: [
        'Expect aftershocks and be ready to drop, cover and hold on again.',
        'Check yourself and others for injuries; call local emergency services for serious injuries.',
        'If you are near the coast and feel strong or long shaking, or a tsunami warning is issued, follow official instructions and move to higher ground.',
        'Follow your local authorities for evacuation and safety information; avoid damaged buildings.',
        'Use text messages rather than calls where possible to keep phone lines free.',
      ] },
    ],
    officialLinks: [
      { label: 'USGS: Earthquake hazards and preparedness', url: 'https://www.usgs.gov/programs/earthquake-hazards' },
      { label: 'Ready.gov: Earthquakes', url: 'https://www.ready.gov/earthquakes' },
      { label: 'Great ShakeOut: Drop, Cover, Hold On', url: 'https://www.shakeout.org/dropcoverholdon/' },
    ],
    notice: 'General preparedness information only. It is not an official instruction for this event. In an emergency, follow local authorities and call your local emergency number.',
  };
}
