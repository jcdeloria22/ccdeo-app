/* workflow-data.js — the ME Workflow's content, lifted VERBATIM from
 * ME-Reviewer/ME-Workflow.html. Three process flows with their phases, steps,
 * responsible parties, outputs and traps; the testing-requirement tables; the
 * study-path day labels.
 *
 * This is authored domain content, not presentation. It was moved, not retyped.
 * The only change: the colour names the flows use (--blu, --grn, --pur, --red,
 * --cyan, --amber) are mapped onto this app's tokens in app.css.
 */
(function (root) {
  'use strict';

const FLOW_META={
 materials:{
  intro:`The materials quality-control cycle on a DPWH project, from before the first delivery to final acceptance.
    <b>Quality Control is the contractor's responsibility; Quality Assurance is DPWH's.</b>
    The contractor's Materials Engineer works under the supervision of the DPWH Materials Engineer,
    and only the DPWH ME recommends acceptance or rejection.`,
  legend:[['var(--blu)','Contractor QC'],['var(--grn)','DPWH QA'],
          ['var(--pur)','Documentation'],['var(--red)','Non-conformance']],
  labels:{qc:'Contractor QC',qa:'DPWH QA',doc:'Document',fail:'Non-conformance'}},
 geotech:{
  intro:`Subsurface investigation for road and structure design, per <b>DO 075 s.2024</b> and the DPWH
    geotechnical investigation methodology. The governing principle from the manual:
    <b>obtain the maximum amount of information at a minimum cost and effort</b> — which is why
    desk study comes before anyone mobilises a drill rig.`,
  legend:[['var(--cyan)','Planning'],['var(--amber)','Field work'],
          ['var(--blu)','Laboratory'],['var(--pur)','Reporting']],
  labels:{plan:'Planning',field:'Field',lab:'Laboratory',doc:'Report'}},
 pe:{
  intro:`The DPWH project lifecycle as taught in your <b>Comprehensive Course for Field Engineers</b>
    — four modules across sixteen days, from environmental clearance through to acceptance.
    Module 4 hands over directly to the Materials QC/QA flow.`,
  legend:[['var(--cyan)','Development &amp; design'],['var(--amber)','Construction'],
          ['var(--blu)','Management'],['var(--grn)','Quality assurance']],
  labels:{plan:'Development',field:'Construction',lab:'Management',qa:'Quality assurance'}}
};

const FLOWS={};

FLOWS.geotech=[
 {ph:'Desk study', when:'Before mobilization', steps:[
  {r:'plan', t:'Literature review',
   d:'Gather prior subsurface investigations at or near the site before planning any new boring.',
   who:'Geotechnical engineer', out:'Historical data set',
   note:'Sources named in the BRS lecture deck: NAMRIA for maps, DENR-MGB for geological and mineral data, GeoRisk PH for hazard exposure, FaultFinder for proximity to active faults. These four are from training material, not from DO 075 s.2024 itself — the order does not name them.',
   refs:['NAMRIA','DENR-MGB','GeoRisk PH','FaultFinder']},
  {r:'plan', t:'Reconnaissance survey',
   d:'Walk the alignment to confirm what the desk study suggested and to spot access, drainage and terrain constraints.',
   who:'Geotechnical engineer', out:'Field notes',
   note:'', refs:['Recon']},
  {r:'plan', t:'Set spacing, depth and method',
   d:'Borehole spacing, depth and exploration type are fixed by structure type — new road, rehabilitation, culvert, bridge. See the Geotechnical card under Materials for the full table.',
   who:'Geotechnical engineer', out:'Investigation plan',
   note:'New roads: test pitting every 500 m for homogeneous strata, 250 m for loose or heterogeneous strata, closer for soft marshy sections.',
   refs:['DO 075 s.2024']}
 ]},
 {ph:'Field investigation', when:'On site', steps:[
  {r:'field', t:'Test pitting and cone penetration',
   d:'The minimum requirement for most road works. Dynamic Cone Penetration Test accompanies test pitting on rehabilitation projects.',
   who:'Field crew', out:'Test pit records',
   note:'Where DED shows excavation 1.50 m or deeper, confirmatory test pitting must be repeated at the same station during implementation.',
   refs:['Test pitting','DCPT','CPT']},
  {r:'field', t:'Standard Penetration Test',
   d:'Split-spoon sampler driven by hammer; N-value is the blow count to drive 30 cm. Estimates relative density of cohesionless soils and shear strength of cohesive soils.',
   who:'Drilling crew', out:'N-values, disturbed samples',
   note:'Run length is 450 mm. Sample recovery % = length recovered ÷ 450 mm × 100.',
   refs:['ASTM D1586','N-value','Split spoon']},
  {r:'field', t:'Undisturbed and rock sampling',
   d:'Thin-wall Shelby tube for undisturbed soil; diamond-bit core barrel for rock.',
   who:'Drilling crew', out:'Undisturbed samples, rock cores',
   note:'Undisturbed samples are sealed with wax to preserve natural moisture content in transit.',
   refs:['Shelby tube','Diamond bit','Wax seal']},
  {r:'doc', t:'Subsurface Exploration Log',
   d:'The BRS boring log records project, location, borehole number, ground elevation, casing depth, GPS coordinates and water level against depth.',
   who:'Field engineer', out:'Boring log',
   note:'Water level matters as much as the strata — it governs effective stress and buildability.',
   refs:['Boring Log','BRS']}
 ]},
 {ph:'Laboratory', when:'After sampling', steps:[
  {r:'lab', t:'Minimum test suite',
   d:'Mechanical sieve analysis, specific gravity, Atterberg limits, natural moisture content, compaction, laboratory CBR and swell index.',
   who:'Geotechnical laboratory', out:'Test results',
   note:'One CBR test is required for every layer of each test pit — not one per pit.',
   refs:['Sieve','Atterberg','CBR','Swell index']},
  {r:'lab', t:'Conditional tests',
   d:'Triggered by complex ground conditions or deep cuts: consolidation, permeability, soil/rock strength and hydrometer analysis.',
   who:'Geotechnical laboratory', out:'Additional results',
   note:'These are the tests that catch settlement and slope-stability problems. Skipping them on soft ground is how embankments fail later.',
   refs:['Consolidation','Permeability','Hydrometer']}
 ]},
 {ph:'Interpretation', when:'Before design', steps:[
  {r:'doc', t:'Classification',
   d:'Visual classification of soil and rock in the field, confirmed by the Unified Soil Classification System from laboratory grading and plasticity.',
   who:'Geotechnical engineer', out:'Classified profile',
   note:'', refs:['USCS','Visual classification']},
  {r:'doc', t:'Geotechnical report',
   d:'Ties the logs, laboratory results and classification into design recommendations — bearing capacity, settlement, slope stability, foundation type.',
   who:'Geotechnical engineer', out:'Geotechnical Report',
   note:'This report is an input to Detailed Engineering Design, which is where the Project Lifecycle flow picks up.',
   refs:['Geotechnical Report','DED']}
 ]}
];

FLOWS.pe=[
 {ph:'Module 1 — Development & design', when:'Days 1–4', steps:[
  {r:'plan', t:'Environmental and social impact assessment',
   d:'EIA regulatory framework and the clearances a project needs before it can proceed.',
   who:'Project development', out:'ECC / clearances',
   note:'', refs:['ESIA','EIA framework']},
  {r:'plan', t:'Engineering surveys and gender assessment',
   d:'Topographic and alignment surveys, alongside GAD checklists for infrastructure projects.',
   who:'Survey team, planning', out:'Survey data, GAD checklists',
   note:'GAD checklists appear as Box 10 for infrastructure and Boxes 16–17 for PIMME.',
   refs:['DO 048 s.2011','GAD Box 10','GAD Box 16–17']},
  {r:'plan', t:'Right-of-way and resettlement',
   d:'Resettlement Action Plan preparation and reporting procedures where the alignment displaces occupants.',
   who:'ROW / RAP team', out:'RAP report',
   note:'', refs:['RAP','PCP','ROW']},
  {r:'plan', t:'Geological and geohazard assessment',
   d:'Site hazard screening feeding into the geotechnical investigation.',
   who:'Geologist', out:'Geohazard assessment',
   note:'This is where the Geotechnical Investigation flow attaches.',
   refs:['Geohazard']},
  {r:'plan', t:'Hydrology and structure design',
   d:'Hydrologic analysis, flood control structures, HEC-HMS and HEC-RAS modelling, design issuances.',
   who:'Design engineers', out:'Design analysis',
   note:'', refs:['Hydrology','HMS','RAS']},
  {r:'plan', t:'Detailed Engineering Design',
   d:'Standard design plans, building design, and a completeness and correctness check of DED drawings.',
   who:'Design engineers', out:'DED plans',
   note:'Errors caught at DED review cost far less than variation orders during construction.',
   refs:['Standard plans','DED review']}
 ]},
 {ph:'Module 2 — Construction', when:'Days 5–9', steps:[
  {r:'field', t:'Pre-construction surveys',
   d:'Establish and verify controls before work starts.',
   who:'Field engineer', out:'Survey records',
   note:'', refs:['Pre-construction survey']},
  {r:'field', t:'Construction methodology',
   d:'Flood control and drainage, building construction methods, and bridge construction methods.',
   who:'Field engineer', out:'Method statements',
   note:'', refs:['Flood control','Building','Bridge']},
  {r:'field', t:'Safety and traffic management',
   d:'Road works safety, traffic control devices and management of the work zone.',
   who:'Field engineer, safety officer', out:'Traffic management plan',
   note:'', refs:['Traffic control devices']},
  {r:'field', t:'Defects and maintenance',
   d:'Code of defects and maintenance by administration under PHMMS.',
   who:'Maintenance', out:'Defect records',
   note:'', refs:['DO 47 Code Defects','PHMMS']}
 ]},
 {ph:'Module 3 — Project management', when:'Days 10–12', steps:[
  {r:'lab', t:'Monitoring and control',
   d:'Track physical and financial progress against the programme of work.',
   who:'Project engineer', out:'Monitoring reports',
   note:'', refs:['Monitoring','PDM']},
  {r:'lab', t:'Time variance',
   d:'Work suspension orders, work resumption orders and contract time extensions.',
   who:'Project engineer', out:'WSO / WRO / CTE',
   note:'Time variance instruments are the formal record of why a project slipped. Negative slippage without them is exposure.',
   refs:['WSO','WRO','CTE']},
  {r:'lab', t:'Contract management',
   d:'Billings, variation orders, price escalation, and the consequences of failure — termination, blacklisting, negative slippage.',
   who:'Project engineer, contract unit', out:'Contract actions',
   note:'', refs:['Variation order','Price escalation','Blacklisting']}
 ]},
 {ph:'Module 4 — Quality assurance', when:'Days 13–16', steps:[
  {r:'qa', t:'Sampling and Minimum Test Requirements',
   d:'MTR Volume III governs what must be sampled and how often, with lab worksheets and the sample card format.',
   who:'Materials Engineer', out:'Sampling programme',
   note:'This is the same MTR that drives the Materials QC/QA flow — switch to that tab for the per-item cycle.',
   refs:['DO 049 s.2021','DO 086 s.2025','MTR Vol III']},
  {r:'qa', t:'Design mix and job mix',
   d:'Approval of concrete design mix and asphalt job-mix formula before production.',
   who:'Materials Engineer', out:'Approved mixes',
   note:'', refs:['Design mix','Job mix']},
  {r:'qa', t:'Inspection and supervision',
   d:'Field inspection duties and the supervision chain during construction.',
   who:'Project / Materials Engineer', out:'Inspection records',
   note:'', refs:['Inspection']},
  {r:'qa', t:'QA/QC documentation',
   d:'The documentation set and QA/QC policies that evidence compliance.',
   who:'Materials Engineer', out:'QA/QC documents',
   note:'', refs:['QAQC policies']},
  {r:'qa', t:'Acceptance',
   d:'Final acceptance against the DPWH Standard Specifications material requirements.',
   who:'DPWH', out:'Acceptance',
   note:'', refs:['Acceptance','Standard Specifications']}
 ]}
];

FLOWS.materials=[
 {ph:'Before construction', when:'Pre-mobilization', steps:[
  {r:'qc', t:'Prepare the Quality Control Program',
   d:'Set out how many samples for each item of work will be tested, based on the Minimum Testing Requirements.',
   who:'Contractor Materials Engineer', out:'Quality Control Program',
   note:'This is the plan the whole cycle is measured against. Without it there is no basis for saying a project is under-tested.',
   refs:['MTR','Module VI']},
  {r:'qc', t:'Identify and sample the source',
   d:'Sampling and testing of aggregates begins as soon as the source is identified — not on delivery.',
   who:'Contractor ME', out:'Preliminary / source samples',
   note:'Testing early means an unsuitable quarry is rejected before it costs a delivery.',
   refs:['Item 200','Item 201']},
  {r:'qa', t:'Approve the source',
   d:'DPWH tests the preliminary samples and approves the source for use.',
   who:'DPWH Materials Engineer', out:'Source approval',
   note:'Approval of preliminary samples is NOT a guarantee of acceptance of all material later drawn from that source. Every lot still gets tested.',
   refs:['MTT Exam 2021']}
 ]},
 {ph:'During construction', when:'Per delivery / per lot', steps:[
  {r:'qc', t:'Sample at the specified frequency',
   d:'Draw samples per the Minimum Testing Requirements for each item — by volume, mass, area or shipment depending on the material.',
   who:'Contractor ME', out:'Field samples',
   note:'Frequencies differ sharply by material. See the Materials tab for the per-item figures.',
   refs:['1 set / 75 m³','1 / 130 t','1 m / 10,000 kg']},
  {r:'doc', t:'Fill out the Sample Card',
   d:'Each sample carries a tag naming the project, quantity represented, kind of sample, original source, who sampled and submitted it, and the dates.',
   who:'Contractor ME', out:'Sample Card',
   note:'Samples must be well packed in durable containers to survive transit, and the card signed by the ME. An unlabelled sample is an untraceable one.',
   refs:['Sample Card']},
  {r:'qa', t:'Laboratory testing',
   d:'The laboratory runs the required tests using the applicable AASHTO or ASTM method.',
   who:'DPWH / accredited laboratory', out:'Raw test data',
   note:'Lead times matter for scheduling — a cement quality test takes about one month, so it must be programmed well ahead of use.',
   refs:['AASHTO','ASTM']},
  {r:'qc', t:'Field control tests',
   d:'Compaction by Field Density Test, consistency by slump, thickness and density by coring — run alongside laboratory work.',
   who:'Contractor ME, witnessed by DPWH', out:'Field test results',
   note:'Do not run a field density test after heavy rain; the raised moisture content distorts the result.',
   refs:['FDT','Slump','Cores']}
 ]},
 {ph:'Reporting', when:'Continuous, weekly, monthly', steps:[
  {r:'doc', t:'Materials Test Report',
   d:'The laboratory issues the result. This report is the sole basis for accepting or rejecting a material.',
   who:'Laboratory → DPWH ME', out:'Materials Test Report',
   note:'Not the delivery receipt, not the supplier certificate, not visual inspection — the test report.',
   refs:['MTR']},
  {r:'doc', t:'Update the Status of Test',
   d:'Running tally of what has been submitted, what has been tested, and what is still owed against the Quality Control Program.',
   who:'Contractor ME', out:'Status of Test',
   note:'This is the report the ME consults to know the remaining balance of quality tests.',
   refs:['Status of Test']},
  {r:'doc', t:'Certificate of Quality Control Assurance',
   d:'Weekly certification that quality control has been carried out as programmed.',
   who:'Contractor ME → DPWH', out:'CQCA — weekly',
   note:'Weekly, not monthly. A common exam trap.',
   refs:['CQCA']},
  {r:'doc', t:'Monthly Quality Control Report',
   d:'Summary of field tests together with the status of test for the month.',
   who:'Contractor ME → DPWH', out:'Monthly report',
   note:'',
   refs:['Monthly QC Report']}
 ]},
 {ph:'Decision', when:'Per lot', steps:[
  {r:'qa', t:'Accept or reject',
   d:'The DPWH Materials Engineer recommends acceptance or rejection on the strength of the test results.',
   who:'DPWH Materials Engineer', out:'Recommendation',
   note:'All materials must be tested before they are incorporated into the work — not after.',
   refs:['Acceptance']},
  {r:'fail', t:'If a sample fails',
   d:'A failed sample does not by itself condemn the structure — the sampling may have been faulty. Where two tests on one lot disagree, a third referee test settles it.',
   who:'DPWH ME', out:'Referee test',
   note:'Investigate the sampling before condemning the work.',
   refs:['Referee test']},
  {r:'fail', t:'Remedial action',
   d:'For pavement strength failures, recoring verifies in-place strength before any decision. Outcomes range from acceptance at reduced price to removal and replacement.',
   who:'DPWH ME → Project Engineer', out:'Remedial measure',
   note:'Strength deficiency of 10% to under 15% permits payment at 70% of contract price. A deficiency of 25% or more means no payment at all.',
   refs:['Recoring','Price deduction']}
 ]}
];

const MATS=[
 {id:'soils',ic:'⛰️',n:'Soils & Embankment',s:'Item 104 · Selected borrow · Subgrade',
  rows:[
   ['Grading / sieve analysis','AASHTO T 88','1 per 1,500 m³','All passing 75 mm; ≤15% passing 0.075 mm'],
   ['Liquid Limit','AASHTO T 89','1 per 1,500 m³','Selected borrow topping: max 30'],
   ['Plasticity Index','AASHTO T 90','1 per 1,500 m³','Selected borrow: max 6'],
   ['Moisture-Density (MDD/OMC)','AASHTO T 180','1 per 1,500 m³','Method D — 4.54 kg rammer, 457 mm drop'],
   ['Field Density Test','AASHTO T 191','3 per 500 m² per layer','95% of MDD, layer by layer'],
   ['Layer thickness','—','Every layer','Max 200 mm loose / 150 mm compacted']
  ],
  note:'Unsuitable material: LL over 80, PL over 55, or density 800 kg/m³ or lower. Peat and muck are highly organic and always unsuitable.'},

 {id:'agg',ic:'🪨',n:'Aggregate Subbase & Base',s:'Item 200 · 201 · 202',
  rows:[
   ['Grading','AASHTO T 27 / T 11','1 per 300 m³ per source','Item 200: 50mm=100, 25mm=55–85, 9.5mm=40–75, No.200=0–12'],
   ['Liquid Limit','AASHTO T 89','1 per 300 m³ per source','Item 200: max 35 · Items 201/202: max 25'],
   ['Plasticity Index','AASHTO T 90','1 per 300 m³ per source','Item 200: max 12 · Items 201/202: max 6'],
   ['Soaked CBR — Items 200/201','AASHTO T 193','1 per 3,000 m³ per source','Item 200: see note · Item 201: min 80%'],
   ['Soaked CBR — Item 202','AASHTO T 193','1 per 1,500 m³ per source','Min 80%'],
   ['Abrasion — Items 200/201','AASHTO T 96','1 per 3,000 m³ per source','Max 50% (coarse portion retained No.10)'],
   ['Abrasion — Item 202','AASHTO T 96','1 per 1,500 m³ per source','Max 45%; ≥50% with one fractured face'],
   ['Compaction','AASHTO T 180 D','1 per 1,500 m³ per source','100% of MDD'],
   ['Field Density','AASHTO T 191','Every layer of 200 mm','100% compaction each layer']
  ],
  note:'Frequencies above are contractor QC; DPWH quality assurance is half as often (double the volume). Item 202 is tested twice as often as 200/201 for CBR and abrasion — a common trap. Layers: where required thickness exceeds 150 mm, spread and compact in two or more layers, none exceeding 150 mm compacted. ⚠ Item 200 CBR is unresolved between editions — Blue Book Vol II 2004 §200.2 says "not less than 25%", current training material says 30%. Know both.'},

 {id:'concrete',ic:'🧱',n:'Concrete & PCCP',s:'Item 311 · 405 · Structural concrete',
  rows:[
   ['Compressive strength','AASHTO T 22','1 set (3 cyl) per 75 m³','Class A 3,500 psi · Class C 3,000 psi · Class P 5,000 psi'],
   ['Flexural strength (beam)','AASHTO T 97','1 set (3 beams) per 270 m² at 280 mm depth, or 250 m² at 300 mm — max 75 m³ per set','Third-point 3.8 MPa at 14 days'],
   ['Flexural (mid-point)','AASHTO T 177','As required','4.5 MPa at 14 days'],
   ['Slump','AASHTO T 119','Every truck / batch','Vibrated 10–40 mm · Not vibrated 40–75 mm'],
   ['Cores (thickness)','AASHTO T 24','5 holes per km per lane','9 caliper measurements per core'],
   ['Cement quality','—','1 sample (10 kg) per 2,000 bags','Lead time about 1 month'],
   ['Concrete hollow blocks','ASTM C140','6 pcs per 10,000 units','Load-bearing 5.5 MPa individual']
  ],
  note:'Curing 72 hours. Forms removed at 24 hours for pavement. Road not opened to traffic until 14 days if no strength test was run. Where beams were not taken, cores must reach 3,500 psi at 14 days.'},

 {id:'asphalt',ic:'🛣️',n:'Asphalt & Bituminous',s:'Item 310 · 300–304',
  rows:[
   ['Bituminous material (binder)','Quality test','1 per 40 metric tons or 200 drums','Cutback · emulsified · asphalt cement'],
   ['Extraction (asphalt content)','AASHTO T 164','1 per 130 metric tons of mix','Job-mix ± 0.4%'],
   ['Marshall stability','AASHTO T 245','Per job-mix design','Heavy traffic min 1,800 lbs at 60°C'],
   ['Air voids','—','Per mix','3% to 5%'],
   ['Index of Retained Strength','AASHTO T 165','Per mix','Min 70%'],
   ['Core thickness / density','—','Per lot','4 caliper measurements; min 100 mm dia. core'],
   ['Field compaction','—','Per lot','≥95% of laboratory compacted density'],
   ['Grading of extracted agg.','AASHTO T 30','1 per 130 tonnes','No. 4 and larger ±7 · No. 200 ±2']
  ],
  note:'Mix placed at min 107°C. Mixing temperature 163°C; aggregates heated 177–191°C. Rolling begins at the sides toward the centreline, overlapping half the roller width. Traffic only once cooled to atmospheric temperature.'},

 {id:'geotech',ic:'🕳️',n:'Geotechnical Investigation',s:'DO 075 s.2024 · Boring spacing, depth & lab suite',
  rows:[
   ['New road / widening','Test pitting','500 m homogeneous · 250 m loose or heterogeneous','Closer for soft marshy sections'],
   ['Existing earth road','Test pitting','250 m if traffic >300 vpd · else 500 m','Staggered pattern, offset from centreline'],
   ['Rehabilitation (reconstruction)','Test pitting + DCPT','500 m, staggered offsets','Min 1.50 m below cut at ditch line or subgrade'],
   ['Rehabilitation (re-blocking)','Test pitting + DCPT','1 per 100 m of rehabilitated section','Urban areas may adopt previous results'],
   ['RCPC under 50 m','Test pitting','1 pit at midpoint or critical location','Applies to cross-drains'],
   ['RCPC 50 m or longer','Test pitting','1 at start, 1 at end, +1 per 500 m','—'],
   ['Light cut/fill under 1 m','—','—','Extend to max 1.5 m below proposed subgrade'],
   ['Deeper cuts over 1 m','—','—','Extend to 2 m below proposed subgrade'],
   ['Soft clay / marshland','Auger boring, CPT','Per geotechnical engineer','May extend 20–25 m; base of soft clay must be identified']
  ],
  note:'✔ Verified against DO 075 s.2024 (Guidelines for the Conduct of Geotechnical Investigation) — spacing, depths and lab suite all confirmed. Minimum laboratory suite: mechanical sieve analysis, specific gravity, Atterberg limits, natural moisture content, compaction, laboratory CBR, swell index. Conditional for complex ground or deep cuts: consolidation, permeability, soil/rock strength, hydrometer. One CBR test per layer of each test pit — not one per pit. Where DED shows excavation 1.50 m or deeper, confirmatory test pitting must be repeated at the same station during implementation.'},

 {id:'steel',ic:'🔩',n:'Steel & Miscellaneous',s:'RSB · GI sheets · Paint · Pipes',
  rows:[
   ['Reinforcing steel bars','ASTM A615','1.0 m per 10,000 kg per size per shipment','Grade 40: 276 MPa yield · Grade 60: 414 MPa'],
   ['Bend test','—','Same sample','Pin 6d for 10–20 mm dia.'],
   ['Mass variation','—','Same sample','Max 6% under nominal mass'],
   ['GI sheets','—','3 pcs 60×60 mm from 1 sheet per 100','Triple spot / single spot zinc test'],
   ['Paint','—','1 can per 100 cans','Reflectorized: min 10 kg sample'],
   ['RCCP','ASTM C76','1 set cylinders per 25 pcs','Three-edge bearing: 0.3 mm crack']
  ],
  note:'Maximum phosphorus content in billet steel bars is 0.06%.'}
];

const DAYS={
 MTT:{
  1:'Introduction to Materials Testing · Laboratory Safety',
  2:'Soil lecture',
  8:'Scanned field notes',
  10:'Concrete — manual and mix design (Module II)',
  13:'Miscellaneous materials — RCCP absorption, CHB, paint, galvanized sheets, phosphorus in steel',
  16:'Asphalt — Part 1',
  17:'Liquid asphalt — emulsified, cut-back, joint sealer',
  18:'Bituminous mix'},
 PE:{
  1:'ESIA — EIA regulatory framework',
  2:'Surveys, GAD checklists, RAP, geohazard',
  3:'Hydrology, flood control, design issuances, DED plans',
  4:'Building design',
  5:'Flood control and drainage construction methodology',
  6:'Road works safety and traffic management',
  7:'Pre-construction surveys · Building construction methods',
  8:'Building construction methods (updated)',
  9:'Traffic control devices · Bridge construction · Code defects · PHMMS',
  10:'Project monitoring and control · Time variance',
  11:'Project development management',
  12:'Contract management — billings, variation orders, escalation, termination',
  13:'Sampling and MTR Vol III · Design mix and job mix · Inspection',
  14:'QA/QC documentation and policies · Acceptance',
  15:'DPWH Standard Specifications',
  16:'Bridge construction methods · Case study'}
};
const STUDY_INTRO={
 MTT:`Your MTT training sequence with the files belonging to each day. Tick a day when you've
   reviewed it — progress is saved in this browser only.`,
 PE:`The Comprehensive Course for Field Engineers, four modules across sixteen days.
   Days 13–16 are the quality-assurance module that feeds the Materials QC/QA flow.`
};

  root.WORKFLOW_DATA = { FLOW_META, FLOWS, MATS, DAYS, STUDY_INTRO };
})(window);
