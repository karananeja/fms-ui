export interface CityCentre {
  name: string;
  state: string;
  lat: number;
  lng: number;
}

export interface CityFleet {
  name: string;
  centres: [CityCentre, CityCentre];
}

const c = (name: string, state: string, lat: number, lng: number): CityCentre => ({
  name,
  state,
  lat,
  lng,
});

/** 4 regions × 5 cities × 2 centres = 40 Indian city centres. */
export const REGIONS: { name: string; cities: CityFleet[] }[] = [
  {
    name: 'North',
    cities: [
      {
        name: 'Delhi',
        centres: [c('Delhi', 'DL', 28.6139, 77.209), c('Noida', 'UP', 28.5355, 77.391)],
      },
      {
        name: 'Chandigarh',
        centres: [c('Chandigarh', 'CH', 30.7333, 76.7794), c('Mohali', 'PB', 30.7046, 76.7179)],
      },
      {
        name: 'Jaipur',
        centres: [c('Jaipur', 'RJ', 26.9124, 75.7873), c('Ajmer', 'RJ', 26.4499, 74.6399)],
      },
      {
        name: 'Lucknow',
        centres: [c('Lucknow', 'UP', 26.8467, 80.9462), c('Kanpur', 'UP', 26.4499, 80.3319)],
      },
      {
        name: 'Dehradun',
        centres: [c('Dehradun', 'UK', 30.3165, 78.0322), c('Haridwar', 'UK', 29.9457, 78.1642)],
      },
    ],
  },
  {
    name: 'South',
    cities: [
      {
        name: 'Bengaluru',
        centres: [c('Bengaluru', 'KA', 12.9716, 77.5946), c('Mysuru', 'KA', 12.2958, 76.6394)],
      },
      {
        name: 'Chennai',
        centres: [c('Chennai', 'TN', 13.0827, 80.2707), c('Vellore', 'TN', 12.9165, 79.1325)],
      },
      {
        name: 'Hyderabad',
        centres: [c('Hyderabad', 'TS', 17.385, 78.4867), c('Warangal', 'TS', 17.9689, 79.5941)],
      },
      {
        name: 'Kochi',
        centres: [
          c('Kochi', 'KL', 9.9312, 76.2673),
          c('Thiruvananthapuram', 'KL', 8.5241, 76.9366),
        ],
      },
      {
        name: 'Coimbatore',
        centres: [c('Coimbatore', 'TN', 11.0168, 76.9558), c('Madurai', 'TN', 9.9252, 78.1198)],
      },
    ],
  },
  {
    name: 'East',
    cities: [
      {
        name: 'Kolkata',
        centres: [c('Kolkata', 'WB', 22.5726, 88.3639), c('Howrah', 'WB', 22.5958, 88.2636)],
      },
      {
        name: 'Bhubaneswar',
        centres: [c('Bhubaneswar', 'OD', 20.2961, 85.8245), c('Cuttack', 'OD', 20.4625, 85.883)],
      },
      {
        name: 'Patna',
        centres: [c('Patna', 'BR', 25.5941, 85.1376), c('Gaya', 'BR', 24.7914, 85.0002)],
      },
      {
        name: 'Guwahati',
        centres: [c('Guwahati', 'AS', 26.1445, 91.7362), c('Shillong', 'ML', 25.5788, 91.8933)],
      },
      {
        name: 'Ranchi',
        centres: [c('Ranchi', 'JH', 23.3441, 85.3096), c('Jamshedpur', 'JH', 22.8046, 86.2029)],
      },
    ],
  },
  {
    name: 'West',
    cities: [
      {
        name: 'Mumbai',
        centres: [c('Mumbai', 'MH', 19.076, 72.8777), c('Thane', 'MH', 19.2183, 72.9781)],
      },
      {
        name: 'Pune',
        centres: [c('Pune', 'MH', 18.5204, 73.8567), c('Nashik', 'MH', 19.9975, 73.7898)],
      },
      {
        name: 'Ahmedabad',
        centres: [c('Ahmedabad', 'GJ', 23.0225, 72.5714), c('Vadodara', 'GJ', 22.3072, 73.1812)],
      },
      {
        name: 'Surat',
        centres: [c('Surat', 'GJ', 21.1702, 72.8311), c('Rajkot', 'GJ', 22.3039, 70.8022)],
      },
      {
        name: 'Indore',
        centres: [c('Indore', 'MP', 22.7196, 75.8577), c('Bhopal', 'MP', 23.2599, 77.4126)],
      },
    ],
  },
];

export const CENTRES: CityCentre[] = REGIONS.flatMap((r) =>
  r.cities.flatMap((city) => city.centres),
);

export interface VehicleModel {
  slug: string;
  assetTypeId: string;
  assetType: string;
  fuelType: 'EV' | 'Diesel';
  make: string;
  model: string;
  variant: string;
  kwh: string;
  voltage: number;
  swappable: 'Yes' | 'No';
  transmission: string;
  rangeKm: number;
  speedKmh: [number, number];
  wmi: string;
  vds: string;
  weight: number;
}

const m = (v: VehicleModel) => v;

/** Small make/model catalogue: e-scooter, e-3W, e-car, ICE truck. */
export const MODELS: VehicleModel[] = [
  m({
    slug: 'bgauss',
    assetTypeId: '1',
    assetType: 'e scooter',
    fuelType: 'EV',
    make: 'BGauss',
    model: 'C12',
    variant: 'i Max',
    kwh: '2.7',
    voltage: 48,
    swappable: 'Yes',
    transmission: 'AT',
    rangeKm: 85,
    speedKmh: [18, 40],
    wmi: 'P6D',
    vds: 'ED30BP',
    weight: 18,
  }),
  m({
    slug: 'ather',
    assetTypeId: '1',
    assetType: 'e scooter',
    fuelType: 'EV',
    make: 'Ather',
    model: '450X',
    variant: 'Gen 3',
    kwh: '3.7',
    voltage: 51,
    swappable: 'No',
    transmission: 'AT',
    rangeKm: 110,
    speedKmh: [20, 45],
    wmi: 'MZA',
    vds: 'X45G3A',
    weight: 15,
  }),
  m({
    slug: 'tvs',
    assetTypeId: '1',
    assetType: 'e scooter',
    fuelType: 'EV',
    make: 'TVS',
    model: 'iQube',
    variant: 'S',
    kwh: '3.4',
    voltage: 51,
    swappable: 'No',
    transmission: 'AT',
    rangeKm: 100,
    speedKmh: [18, 42],
    wmi: 'MD6',
    vds: 'EQ1BSX',
    weight: 12,
  }),
  m({
    slug: 'mahindra',
    assetTypeId: '2',
    assetType: 'e 3w',
    fuelType: 'EV',
    make: 'Mahindra',
    model: 'Treo',
    variant: 'Plus',
    kwh: '10.2',
    voltage: 48,
    swappable: 'No',
    transmission: 'AT',
    rangeKm: 150,
    speedKmh: [15, 35],
    wmi: 'MA1',
    vds: 'TR3EPL',
    weight: 12,
  }),
  m({
    slug: 'piaggio',
    assetTypeId: '2',
    assetType: 'e 3w',
    fuelType: 'EV',
    make: 'Piaggio',
    model: 'Ape E-City',
    variant: 'FX Max',
    kwh: '8.0',
    voltage: 48,
    swappable: 'Yes',
    transmission: 'AT',
    rangeKm: 145,
    speedKmh: [15, 35],
    wmi: 'MBX',
    vds: 'APEFXM',
    weight: 8,
  }),
  m({
    slug: 'tata',
    assetTypeId: '3',
    assetType: 'e car',
    fuelType: 'EV',
    make: 'Tata',
    model: 'Nexon EV',
    variant: 'Long Range',
    kwh: '40.5',
    voltage: 320,
    swappable: 'No',
    transmission: 'AT',
    rangeKm: 400,
    speedKmh: [25, 60],
    wmi: 'MAT',
    vds: 'NXEVLR',
    weight: 9,
  }),
  m({
    slug: 'mg',
    assetTypeId: '3',
    assetType: 'e car',
    fuelType: 'EV',
    make: 'MG',
    model: 'ZS EV',
    variant: 'Excite',
    kwh: '50.3',
    voltage: 350,
    swappable: 'No',
    transmission: 'AT',
    rangeKm: 450,
    speedKmh: [25, 60],
    wmi: 'MZ7',
    vds: 'ZSEVEX',
    weight: 6,
  }),
  m({
    slug: 'tatatruck',
    assetTypeId: '4',
    assetType: 'truck',
    fuelType: 'Diesel',
    make: 'Tata',
    model: 'Ultra T.7',
    variant: 'BS6',
    kwh: '0',
    voltage: 12,
    swappable: 'No',
    transmission: 'MT',
    rangeKm: 700,
    speedKmh: [25, 55],
    wmi: 'MAT',
    vds: 'ULT7B6',
    weight: 11,
  }),
  m({
    slug: 'ashokleyland',
    assetTypeId: '4',
    assetType: 'truck',
    fuelType: 'Diesel',
    make: 'Ashok Leyland',
    model: 'Dost+',
    variant: 'LS',
    kwh: '0',
    voltage: 12,
    swappable: 'No',
    transmission: 'MT',
    rangeKm: 600,
    speedKmh: [25, 55],
    wmi: 'MB1',
    vds: 'DSTPLS',
    weight: 9,
  }),
];

/** Driver names (F11): first × last gives 1,500+ combinations. */
export const DRIVER_FIRST_NAMES = [
  'Aarav',
  'Abhishek',
  'Ajay',
  'Akash',
  'Amit',
  'Anil',
  'Arjun',
  'Ashok',
  'Deepak',
  'Dinesh',
  'Ganesh',
  'Gaurav',
  'Harish',
  'Imran',
  'Jagdish',
  'Karan',
  'Kiran',
  'Mahesh',
  'Manoj',
  'Mohan',
  'Mukesh',
  'Naveen',
  'Nitin',
  'Pankaj',
  'Pradeep',
  'Prakash',
  'Rahul',
  'Rajesh',
  'Rakesh',
  'Ramesh',
  'Ravi',
  'Sachin',
  'Sandeep',
  'Sanjay',
  'Santosh',
  'Satish',
  'Shankar',
  'Sunil',
  'Suresh',
  'Vijay',
  'Vikas',
  'Vinod',
  'Yogesh',
  'Anita',
  'Kavita',
  'Lakshmi',
  'Pooja',
  'Priya',
  'Sunita',
  'Farhan',
];
export const DRIVER_LAST_NAMES = [
  'Sharma',
  'Verma',
  'Gupta',
  'Singh',
  'Kumar',
  'Yadav',
  'Patel',
  'Shah',
  'Reddy',
  'Rao',
  'Naidu',
  'Iyer',
  'Nair',
  'Menon',
  'Pillai',
  'Das',
  'Ghosh',
  'Banerjee',
  'Mukherjee',
  'Chatterjee',
  'Joshi',
  'Kulkarni',
  'Deshmukh',
  'Patil',
  'Pawar',
  'Chauhan',
  'Rathore',
  'Mishra',
  'Tiwari',
  'Pandey',
  'Khan',
  'Ansari',
];
