import type { ResourceItem } from '../../../shared/types';

/**
 * General humanitarian and information resources (homepage-level official sites).
 * None of these claims an organisation is responding to any specific earthquake.
 * Re-check URLs before presenting: they were not link-checked at build time.
 */
export const GENERAL_RESOURCES: ResourceItem[] = [
  { name: 'ReliefWeb (UN OCHA)', category: 'Humanitarian information', url: 'https://reliefweb.int/disasters', why: 'Humanitarian updates and reports on ongoing disasters, published by UN OCHA.' },
  { name: 'GDACS', category: 'General disaster information', url: 'https://www.gdacs.org/', why: 'Global alerts for earthquakes, cyclones, floods and more, from a UN/EU cooperation framework.' },
  { name: 'IFRC', category: 'Official organisation', url: 'https://www.ifrc.org/', why: 'International Federation of Red Cross and Red Crescent Societies: disaster response and appeals.' },
  { name: 'ICRC', category: 'Official organisation', url: 'https://www.icrc.org/', why: 'International Committee of the Red Cross: humanitarian protection and assistance in conflict.' },
  { name: 'UNICEF', category: 'Official organisation', url: 'https://www.unicef.org/', why: 'Support for children and families in emergencies.' },
  { name: 'World Food Programme', category: 'Official organisation', url: 'https://www.wfp.org/', why: 'Food assistance in emergencies.' },
  { name: 'Irish Red Cross', category: 'Official organisation', url: 'https://www.redcross.ie/', why: 'Irish national society of the Red Cross movement.' },
  { name: 'USGS Earthquake Hazards', category: 'Preparedness guidance', url: 'https://www.usgs.gov/programs/earthquake-hazards', why: 'Science and preparedness information about earthquakes.' },
];
