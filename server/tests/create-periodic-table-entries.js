import db from '../db.js';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables
dotenv.config();

// Periodic table elements data (first 100 elements)
const elements = [
  { symbol: "H", name: "Hydrogen", info: "The lightest element, used in fuel cells, rocket fuel, and is essential for star formation." },
  { symbol: "He", name: "Helium", info: "An inert gas used in balloons, cooling MRI machines, and as a protective gas in welding." },
  { symbol: "Li", name: "Lithium", info: "Used in rechargeable batteries, psychiatric medications, and lightweight alloys." },
  { symbol: "Be", name: "Beryllium", info: "Used in aerospace components, X-ray equipment, and nuclear reactors due to its lightweight and strength." },
  { symbol: "B", name: "Boron", info: "Used in borosilicate glass, detergents, and as a neutron absorber in nuclear reactors." },
  { symbol: "C", name: "Carbon", info: "The basis of organic chemistry, used in steel production, graphite, and diamond." },
  { symbol: "N", name: "Nitrogen", info: "Used in fertilizers, refrigeration, and as an inert atmosphere for chemical reactions." },
  { symbol: "O", name: "Oxygen", info: "Essential for respiration, used in medical treatments, and in combustion processes." },
  { symbol: "F", name: "Fluorine", info: "Used in toothpaste, non-stick coatings, and uranium enrichment." },
  { symbol: "Ne", name: "Neon", info: "Used in neon signs, lasers, and cryogenic refrigeration." },
  { symbol: "Na", name: "Sodium", info: "Used in salt, street lights, and as a coolant in nuclear reactors." },
  { symbol: "Mg", name: "Magnesium", info: "Used in lightweight alloys, fireworks, and as a dietary supplement." },
  { symbol: "Al", name: "Aluminum", info: "Used in aircraft construction, packaging, and electrical transmission lines." },
  { symbol: "Si", name: "Silicon", info: "Used in electronics, glass, and solar cells." },
  { symbol: "P", name: "Phosphorus", info: "Used in fertilizers, detergents, and matches." },
  { symbol: "S", name: "Sulfur", info: "Used in fertilizers, gunpowder, and vulcanization of rubber." },
  { symbol: "Cl", name: "Chlorine", info: "Used in water purification, bleach, and PVC production." },
  { symbol: "Ar", name: "Argon", info: "Used in light bulbs, welding, and as an inert atmosphere for scientific experiments." },
  { symbol: "K", name: "Potassium", info: "Essential for plant growth, used in fertilizers and as a nutrient in the human body." },
  { symbol: "Ca", name: "Calcium", info: "Used in cement, plaster, and as a dietary supplement for bone health." },
  { symbol: "Sc", name: "Scandium", info: "Used in aerospace components, sports equipment, and high-intensity lights." },
  { symbol: "Ti", name: "Titanium", info: "Used in aerospace, medical implants, and high-strength alloys." },
  { symbol: "V", name: "Vanadium", info: "Used in steel alloys, aerospace applications, and as a catalyst." },
  { symbol: "Cr", name: "Chromium", info: "Used in stainless steel, chrome plating, and dyes." },
  { symbol: "Mn", name: "Manganese", info: "Used in steel production, batteries, and as a colorant in glass." },
  { symbol: "Fe", name: "Iron", info: "Used in steel, construction, and is essential for hemoglobin in blood." },
  { symbol: "Co", name: "Cobalt", info: "Used in magnets, batteries, and as a catalyst." },
  { symbol: "Ni", name: "Nickel", info: "Used in stainless steel, batteries, and coins." },
  { symbol: "Cu", name: "Copper", info: "Used in electrical wiring, plumbing, and as an antimicrobial agent." },
  { symbol: "Zn", name: "Zinc", info: "Used in galvanization, batteries, and as a dietary supplement." },
  { symbol: "Ga", name: "Gallium", info: "Used in semiconductors, LEDs, and high-temperature thermometers." },
  { symbol: "Ge", name: "Germanium", info: "Used in fiber optics, infrared optics, and as a semiconductor." },
  { symbol: "As", name: "Arsenic", info: "Used in wood preservatives, semiconductors, and some specialized glass." },
  { symbol: "Se", name: "Selenium", info: "Used in electronics, glass production, and as a nutritional supplement." },
  { symbol: "Br", name: "Bromine", info: "Used in flame retardants, pharmaceuticals, and photography." },
  { symbol: "Kr", name: "Krypton", info: "Used in high-powered lasers, photographic flashes, and some specialized lighting." },
  { symbol: "Rb", name: "Rubidium", info: "Used in atomic clocks, vacuum tubes, and some specialized glass." },
  { symbol: "Sr", name: "Strontium", info: "Used in fireworks, glow-in-the-dark products, and some medical applications." },
  { symbol: "Y", name: "Yttrium", info: "Used in LED lights, cancer treatments, and strengthening aluminum and magnesium alloys." },
  { symbol: "Zr", name: "Zirconium", info: "Used in nuclear reactors, ceramics, and as a refractory material." },
  { symbol: "Nb", name: "Niobium", info: "Used in steel alloys, superconducting magnets, and jewelry." },
  { symbol: "Mo", name: "Molybdenum", info: "Used in high-strength steel alloys, electrical contacts, and as a catalyst." },
  { symbol: "Tc", name: "Technetium", info: "Used in nuclear medicine for diagnostic procedures and medical imaging." },
  { symbol: "Ru", name: "Ruthenium", info: "Used in wear-resistant electrical contacts, thick-film resistors, and as a catalyst." },
  { symbol: "Rh", name: "Rhodium", info: "Used in catalytic converters, jewelry, and as a reflective coating." },
  { symbol: "Pd", name: "Palladium", info: "Used in catalytic converters, electronics, and hydrogen storage." },
  { symbol: "Ag", name: "Silver", info: "Used in jewelry, photography, and as an antimicrobial agent." },
  { symbol: "Cd", name: "Cadmium", info: "Used in batteries, pigments, and as a neutron absorber in nuclear reactors." },
  { symbol: "In", name: "Indium", info: "Used in touch screens, solders, and as a semiconductor." },
  { symbol: "Sn", name: "Tin", info: "Used in solder, cans, and bronze alloys." },
  { symbol: "Sb", name: "Antimony", info: "Used in flame retardants, batteries, and as a semiconductor." },
  { symbol: "Te", name: "Tellurium", info: "Used in solar panels, thermoelectric devices, and as a semiconductor." },
  { symbol: "I", name: "Iodine", info: "Used in medicine, photography, and as a disinfectant." },
  { symbol: "Xe", name: "Xenon", info: "Used in high-intensity lamps, anesthesia, and ion propulsion systems." },
  { symbol: "Cs", name: "Cesium", info: "Used in atomic clocks, photoelectric cells, and as a catalyst." },
  { symbol: "Ba", name: "Barium", info: "Used in medical imaging, drilling fluids, and green fireworks." },
  { symbol: "La", name: "Lanthanum", info: "Used in camera lenses, battery electrodes, and hydrogen storage." },
  { symbol: "Ce", name: "Cerium", info: "Used in catalytic converters, self-cleaning ovens, and as a glass polishing agent." },
  { symbol: "Pr", name: "Praseodymium", info: "Used in aircraft engines, permanent magnets, and as a colorant in glass." },
  { symbol: "Nd", name: "Neodymium", info: "Used in powerful magnets, lasers, and as a colorant in glass." },
  { symbol: "Pm", name: "Promethium", info: "Used in nuclear batteries, thickness gauges, and as a light source in specialized watches." },
  { symbol: "Sm", name: "Samarium", info: "Used in magnets, cancer treatments, and as a neutron absorber." },
  { symbol: "Eu", name: "Europium", info: "Used in fluorescent lamps, anti-counterfeiting marks on Euro banknotes, and as a phosphor activator." },
  { symbol: "Gd", name: "Gadolinium", info: "Used in MRI contrast agents, neutron radiography, and as a phosphor." },
  { symbol: "Tb", name: "Terbium", info: "Used in solid-state devices, fuel cells, and as a phosphor activator." },
  { symbol: "Dy", name: "Dysprosium", info: "Used in data storage devices, control rods in nuclear reactors, and high-powered magnets." },
  { symbol: "Ho", name: "Holmium", info: "Used in solid-state lasers, nuclear control rods, and as a colorant in glass." },
  { symbol: "Er", name: "Erbium", info: "Used in fiber optic communications, lasers for medical and dental use, and as a neutron absorber." },
  { symbol: "Tm", name: "Thulium", info: "Used in portable X-ray machines, lasers, and as a radiation source in portable X-ray devices." },
  { symbol: "Yb", name: "Ytterbium", info: "Used in fiber optic technology, improving stainless steel properties, and as a radiation source." },
  { symbol: "Lu", name: "Lutetium", info: "Used in petroleum refining, positron emission tomography (PET) scans, and as a catalyst." },
  { symbol: "Hf", name: "Hafnium", info: "Used in nuclear control rods, plasma cutting tips, and high-temperature alloys." },
  { symbol: "Ta", name: "Tantalum", info: "Used in electronic components, surgical implants, and high-temperature alloys." },
  { symbol: "W", name: "Tungsten", info: "Used in light bulb filaments, heating elements, and armor-piercing ammunition." },
  { symbol: "Re", name: "Rhenium", info: "Used in high-temperature superalloys, catalysts, and electrical contacts." },
  { symbol: "Os", name: "Osmium", info: "Used in electrical contacts, fountain pen tips, and as a catalyst." },
  { symbol: "Ir", name: "Iridium", info: "Used in spark plugs, crucibles, and as a hardening agent for platinum." },
  { symbol: "Pt", name: "Platinum", info: "Used in catalytic converters, jewelry, and laboratory equipment." },
  { symbol: "Au", name: "Gold", info: "Used in jewelry, electronics, and as a monetary standard." },
  { symbol: "Hg", name: "Mercury", info: "Used in thermometers, fluorescent lamps, and dental amalgams." },
  { symbol: "Tl", name: "Thallium", info: "Used in electronics, specialized glass, and medical imaging." },
  { symbol: "Pb", name: "Lead", info: "Used in batteries, radiation shielding, and as a sound absorber." },
  { symbol: "Bi", name: "Bismuth", info: "Used in pharmaceuticals, cosmetics, and low-melting alloys." },
  { symbol: "Po", name: "Polonium", info: "Used in anti-static devices, heating elements in space probes, and as a neutron source." },
  { symbol: "At", name: "Astatine", info: "Primarily used in research due to its rarity and radioactivity." },
  { symbol: "Rn", name: "Radon", info: "Used in radiation therapy for cancer, radiography, and as a tracer in leak detection." },
  { symbol: "Fr", name: "Francium", info: "Primarily used in research due to its extreme rarity and radioactivity." },
  { symbol: "Ra", name: "Radium", info: "Historically used in luminous paints and medical treatments, now primarily in research." },
  { symbol: "Ac", name: "Actinium", info: "Used in neutron sources and as a thermoelectric power source in space probes." },
  { symbol: "Th", name: "Thorium", info: "Used in nuclear fuel, high-temperature ceramics, and specialized glass." },
  { symbol: "Pa", name: "Protactinium", info: "Primarily used in scientific research due to its scarcity and radioactivity." },
  { symbol: "U", name: "Uranium", info: "Used in nuclear power generation, nuclear weapons, and as a colorant in glass." },
  { symbol: "Np", name: "Neptunium", info: "Used in neutron detection equipment and as a component in nuclear devices." },
  { symbol: "Pu", name: "Plutonium", info: "Used in nuclear weapons, nuclear power generation, and as a power source for space missions." },
  { symbol: "Am", name: "Americium", info: "Used in smoke detectors, thickness gauges, and as a portable gamma ray source." },
  { symbol: "Cm", name: "Curium", info: "Used in scientific research, as a power source for space missions, and in alpha particle X-ray spectrometers." },
  { symbol: "Bk", name: "Berkelium", info: "Primarily used in scientific research and the synthesis of heavier elements." },
  { symbol: "Cf", name: "Californium", info: "Used in neutron moisture gauges, metal detectors, and cancer treatment." },
  { symbol: "Es", name: "Einsteinium", info: "Primarily used in scientific research due to its extreme rarity and radioactivity." },
  { symbol: "Fm", name: "Fermium", info: "Primarily used in scientific research and the study of nuclear reactions." },
  { symbol: "Md", name: "Mendelevium", info: "Primarily used in scientific research to study chemical properties of actinides." },
  { symbol: "No", name: "Nobelium", info: "Primarily used in scientific research to understand heavy element chemistry." },
  { symbol: "Lr", name: "Lawrencium", info: "Primarily used in scientific research to study the properties of transuranic elements." }
];

// Function to insert entries
async function insertEntries() {
  try {
    // Get a user ID to associate with the entries
    const pool = await db.poolPromise;
    const userResult = await pool.request().query('SELECT TOP 1 id FROM Users');
    
    if (userResult.recordset.length === 0) {
      console.error('No users found in the database. Please create a user first.');
      process.exit(1);
    }
    
    const userId = userResult.recordset[0].id;
    console.log(`Using user ID: ${userId} for creating entries`);
    
    // First, clear existing entries (optional)
    console.log('Clearing existing entries...');
    await pool.request().query('DELETE FROM VocabEntries');
    
    // Insert new entries
    console.log('Inserting new entries...');
    let successCount = 0;
    
    for (const element of elements) {
      try {
        const entryKey = `${element.symbol} - ${element.name}`;
        const entryValue = element.info;
        
        await pool.request()
          .input('userId', db.sql.UniqueIdentifier, userId)
          .input('entryKey', db.sql.NVarChar, entryKey)
          .input('entryValue', db.sql.NVarChar, entryValue)
          .query('INSERT INTO VocabEntries (userId, entryKey, entryValue) VALUES (@userId, @entryKey, @entryValue)');
        
        successCount++;
        process.stdout.write(`Inserted ${successCount} entries\r`);
      } catch (err) {
        console.error(`Error inserting entry for ${element.symbol}:`, err);
      }
    }
    
    console.log(`\nSuccessfully inserted ${successCount} periodic table element entries.`);
  } catch (err) {
    console.error('Error in insertEntries:', err);
  } finally {
    process.exit(0);
  }
}

// Run the function
insertEntries();
