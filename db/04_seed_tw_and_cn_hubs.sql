-- =============================================================================
-- 04_seed_tw_and_cn_hubs.sql
-- 目標：
-- 1. 將 airports 全球機場字典擴充至 165 座核心客貨運機場 (含真實經緯度，零假值)
-- 2. 規則 A (最高優先級 request_count = 50)：台灣三機場 (TPE/RCTP, KHH/RCKH, TSA/RCSS) 完整雙向航線 (CARGO + PASSENGER)
-- 3. 規則 B (次高優先級 request_count = 20)：中國大陸 25 座核心製造業機場 + HKG 配對 台灣三機場 + 全球 18 座一線樞紐 雙向航線
-- 4. 嚴格排除已存在於 icao_routes_cache 的航線，並使用 ON CONFLICT DO NOTHING 避免重複抓圖
-- =============================================================================

-- [SECTION_1_AIRPORTS]
-- 第一部分：擴充 airports 全球機場字典 (共 165 座)
INSERT INTO airports (icao_code, iata_code, name_zh, name_en, city_zh, country_code, latitude, longitude, is_major_hub)
VALUES
-- 1. 台灣核心與區域機場 (6 座)
('RCTP', 'TPE', '臺灣桃園國際機場', 'Taiwan Taoyuan International Airport', '桃園', 'TW', 25.077731, 121.232822, TRUE),
('RCSS', 'TSA', '臺北松山機場', 'Taipei Songshan Airport', '台北', 'TW', 25.069444, 121.552500, TRUE),
('RCKH', 'KHH', '高雄國際機場', 'Kaohsiung International Airport', '高雄', 'TW', 22.577100, 120.350000, TRUE),
('RCMQ', 'RMQ', '臺中國際機場', 'Taichung International Airport', '台中', 'TW', 24.264669, 120.620581, FALSE),
('RCYU', 'HUN', '花蓮機場', 'Hualien Airport', '花蓮', 'TW', 24.023056, 121.617778, FALSE),
('RCNN', 'TNN', '臺南機場', 'Tainan Airport', '台南', 'TW', 22.950278, 120.205833, FALSE),

-- 2. 中國大陸與港澳台商製造業/貨運樞紐 (32 座)
('VHHH', 'HKG', '香港國際機場', 'Hong Kong International Airport', '香港', 'HK', 22.308919, 113.914603, TRUE),
('VMMC', 'MFM', '澳門國際機場', 'Macau International Airport', '澳門', 'MO', 22.149556, 113.591556, TRUE),
('ZSPD', 'PVG', '上海浦東國際機場', 'Shanghai Pudong International Airport', '上海', 'CN', 31.143378, 121.805214, TRUE),
('ZSSS', 'SHA', '上海虹橋國際機場', 'Shanghai Hongqiao International Airport', '上海', 'CN', 31.197875, 121.336319, TRUE),
('ZBAA', 'PEK', '北京首都國際機場', 'Beijing Capital International Airport', '北京', 'CN', 40.080111, 116.584556, TRUE),
('ZBAD', 'PKX', '北京大興國際機場', 'Beijing Daxing International Airport', '北京', 'CN', 39.509167, 116.410556, TRUE),
('ZGGG', 'CAN', '廣州白雲國際機場', 'Guangzhou Baiyun International Airport', '廣州', 'CN', 23.392436, 113.298786, TRUE),
('ZGSZ', 'SZX', '深圳寶安國際機場', 'Shenzhen Baoan International Airport', '深圳', 'CN', 22.639258, 113.810664, TRUE),
('ZSAM', 'XMN', '廈門高崎國際機場', 'Xiamen Gaoqi International Airport', '廈門', 'CN', 24.544036, 118.127739, TRUE),
('ZSFZ', 'FOC', '福州長樂國際機場', 'Fuzhou Changle International Airport', '福州', 'CN', 25.935064, 119.663272, TRUE),
('ZUCK', 'CKG', '重慶江北國際機場', 'Chongqing Jiangbei International Airport', '重慶', 'CN', 29.719217, 106.641678, TRUE),
('ZUUU', 'CTU', '成都雙流國際機場', 'Chengdu Shuangliu International Airport', '成都', 'CN', 30.578528, 103.947086, TRUE),
('ZUTF', 'TFU', '成都天府國際機場', 'Chengdu Tianfu International Airport', '成都', 'CN', 30.312500, 104.441389, TRUE),
('ZHHH', 'WUH', '武漢天河國際機場', 'Wuhan Tianhe International Airport', '武漢', 'CN', 30.783758, 114.208100, TRUE),
('ZSNJ', 'NKG', '南京祿口國際機場', 'Nanjing Lukou International Airport', '南京', 'CN', 31.742042, 118.862025, TRUE),
('ZSHC', 'HGH', '杭州蕭山國際機場', 'Hangzhou Xiaoshan International Airport', '杭州', 'CN', 30.229503, 120.434453, TRUE),
('ZSNB', 'NGB', '寧波櫟社國際機場', 'Ningbo Lishe International Airport', '寧波', 'CN', 29.826683, 121.461906, TRUE),
('ZSWX', 'WUX', '蘇南碩放國際機場', 'Sunan Shuofang International Airport', '無錫', 'CN', 31.494444, 120.429444, TRUE),
('ZSQD', 'TAO', '青島膠東國際機場', 'Qingdao Jiaodong International Airport', '青島', 'CN', 36.361944, 120.096389, TRUE),
('ZBTJ', 'TSN', '天津濱海國際機場', 'Tianjin Binhai International Airport', '天津', 'CN', 39.124353, 117.346183, TRUE),
('ZYTL', 'DLC', '大連周水子國際機場', 'Dalian Zhoushuizi International Airport', '大連', 'CN', 38.965664, 121.538600, TRUE),
('ZYTX', 'SHE', '瀋陽桃仙國際機場', 'Shenyang Taoxian International Airport', '瀋陽', 'CN', 41.639842, 123.483428, TRUE),
('ZLXY', 'XIY', '西安咸陽國際機場', 'Xian Xianyang International Airport', '西安', 'CN', 34.447119, 108.751592, TRUE),
('ZHCC', 'CGO', '鄭州新鄭國際機場', 'Zhengzhou Xinzheng International Airport', '鄭州', 'CN', 34.519672, 113.840889, TRUE),
('ZGHA', 'CSX', '長沙黃花國際機場', 'Changsha Huanghua International Airport', '長沙', 'CN', 28.189158, 113.219633, TRUE),
('ZPPP', 'KMG', '昆明長水國際機場', 'Kunming Changshui International Airport', '昆明', 'CN', 25.101944, 102.929167, TRUE),
('ZJHK', 'HAK', '海口美蘭國際機場', 'Haikou Meilan International Airport', '海口', 'CN', 19.934856, 110.458961, FALSE),
('ZGNN', 'NNG', '南寧吳圩國際機場', 'Nanning Wuxu International Airport', '南寧', 'CN', 22.608267, 108.172442, FALSE),
('ZSJN', 'TNA', '濟南遙牆國際機場', 'Jinan Yaoqiang International Airport', '濟南', 'CN', 36.857214, 117.215992, FALSE),
('ZSCN', 'KHN', '南昌昌北國際機場', 'Nanchang Changbei International Airport', '南昌', 'CN', 28.865000, 115.900000, FALSE),
('ZSOF', 'HFE', '合肥新橋國際機場', 'Hefei Xinqiao International Airport', '合肥', 'CN', 31.987778, 116.975000, FALSE),
('ZJSY', 'SYX', '三亞鳳凰國際機場', 'Sanya Phoenix International Airport', '三亞', 'CN', 18.302897, 109.412272, FALSE),

-- 3. 日韓與東北亞 (16 座)
('RJAA', 'NRT', '東京成田國際機場', 'Narita International Airport', '東京', 'JP', 35.764722, 140.386389, TRUE),
('RJTT', 'HND', '東京羽田國際機場', 'Tokyo Haneda Airport', '東京', 'JP', 35.552258, 139.779694, TRUE),
('RJBB', 'KIX', '大阪關西國際機場', 'Kansai International Airport', '大阪', 'JP', 34.427299, 135.244056, TRUE),
('RJOO', 'ITM', '大阪伊丹機場', 'Osaka Itami Airport', '大阪', 'JP', 34.785528, 135.438222, FALSE),
('RJGG', 'NGO', '名古屋中部國際機場', 'Chubu Centrair International Airport', '名古屋', 'JP', 34.858414, 136.805408, TRUE),
('RJFF', 'FUK', '福岡機場', 'Fukuoka Airport', '福岡', 'JP', 33.585942, 130.450686, TRUE),
('RJCC', 'CTS', '札幌新千歲機場', 'New Chitose Airport', '札幌', 'JP', 42.775200, 141.692283, TRUE),
('ROAH', 'OKA', '沖繩那霸機場', 'Naha Airport', '沖繩', 'JP', 26.195814, 127.645869, TRUE),
('RJSS', 'SDJ', '仙台機場', 'Sendai Airport', '仙台', 'JP', 38.139722, 140.916944, FALSE),
('RJOA', 'HIJ', '廣島機場', 'Hiroshima Airport', '廣島', 'JP', 34.436111, 132.919444, FALSE),
('RJFK', 'KOJ', '鹿兒島機場', 'Kagoshima Airport', '鹿兒島', 'JP', 31.803397, 130.719408, FALSE),
('RJFT', 'KMJ', '熊本機場', 'Kumamoto Airport', '熊本', 'JP', 32.837319, 130.855050, FALSE),
('RKSI', 'ICN', '首爾仁川國際機場', 'Incheon International Airport', '首爾', 'KR', 37.469075, 126.450517, TRUE),
('RKSS', 'GMP', '首爾金浦國際機場', 'Gimpo International Airport', '首爾', 'KR', 37.558311, 126.790586, TRUE),
('RKPK', 'PUS', '釜山金海國際機場', 'Gimhae International Airport', '釜山', 'KR', 35.179528, 128.938222, TRUE),
('RKPC', 'CJU', '濟州國際機場', 'Jeju International Airport', '濟州', 'KR', 33.511306, 126.493028, FALSE),

-- 4. 東南亞與南亞 (27 座)
('WSSS', 'SIN', '新加坡樟宜機場', 'Singapore Changi Airport', '新加坡', 'SG', 1.350189, 103.994433, TRUE),
('VTBS', 'BKK', '曼谷蘇凡納布國際機場', 'Suvarnabhumi Airport', '曼谷', 'TH', 13.681108, 100.747283, TRUE),
('VTBD', 'DMK', '曼谷廊曼國際機場', 'Don Mueang International Airport', '曼谷', 'TH', 13.912583, 100.606750, TRUE),
('VTCC', 'CNX', '清邁國際機場', 'Chiang Mai International Airport', '清邁', 'TH', 18.766847, 98.962644, FALSE),
('VTSP', 'HKT', '普吉國際機場', 'Phuket International Airport', '普吉島', 'TH', 8.113200, 98.316872, FALSE),
('WMKK', 'KUL', '吉隆坡國際機場', 'Kuala Lumpur International Airport', '吉隆坡', 'MY', 2.745578, 101.709917, TRUE),
('WMKP', 'PEN', '檳城國際機場', 'Penang International Airport', '檳城', 'MY', 5.297139, 100.276864, TRUE),
('WBKK', 'BKI', '亞庇國際機場', 'Kota Kinabalu International Airport', '亞庇', 'MY', 5.937208, 116.051181, FALSE),
('VVTS', 'SGN', '胡志明市新山一國際機場', 'Tan Son Nhat International Airport', '胡志明市', 'VN', 10.818797, 106.651856, TRUE),
('VVNB', 'HAN', '河內內排國際機場', 'Noi Bai International Airport', '河內', 'VN', 21.221192, 105.807178, TRUE),
('VVDN', 'DAD', '峴港國際機場', 'Da Nang International Airport', '峴港', 'VN', 16.043917, 108.199417, TRUE),
('RPLL', 'MNL', '馬尼拉尼諾伊·阿基諾國際機場', 'Ninoy Aquino International Airport', '馬尼拉', 'PH', 14.508647, 121.019581, TRUE),
('RPVM', 'CEB', '宿霧麥克坦國際機場', 'Mactan-Cebu International Airport', '宿霧', 'PH', 10.307542, 123.979439, FALSE),
('RPLC', 'CRK', '克拉克國際機場', 'Clark International Airport', '克拉克', 'PH', 15.185833, 120.560278, FALSE),
('WIII', 'CGK', '雅加達蘇加諾-哈達國際機場', 'Soekarno-Hatta International Airport', '雅加達', 'ID', -6.125567, 106.655897, TRUE),
('WADD', 'DPS', '峇里島伍拉·賴國際機場', 'I Gusti Ngurah Rai International Airport', '峇里島', 'ID', -8.748169, 115.167172, FALSE),
('WARR', 'SUB', '泗水朱安達國際機場', 'Juanda International Airport', '泗水', 'ID', -7.379831, 112.786858, FALSE),
('VDPP', 'PNH', '金邊國際機場', 'Phnom Penh International Airport', '金邊', 'KH', 11.546556, 104.844139, TRUE),
('VYYY', 'RGN', '仰光國際機場', 'Yangon International Airport', '仰光', 'MM', 16.907306, 96.133222, FALSE),
('WBSB', 'BWN', '汶萊國際機場', 'Brunei International Airport', '斯里巴加灣', 'BN', 4.944200, 114.928353, FALSE),
('VLVT', 'VTE', '永珍瓦岱國際機場', 'Wattay International Airport', '永珍', 'LA', 17.988322, 102.563256, FALSE),
('VIDP', 'DEL', '德里英迪拉·甘地國際機場', 'Indira Gandhi International Airport', '德里', 'IN', 28.566500, 77.103088, TRUE),
('VABB', 'BOM', '孟買賈特拉帕蒂·希瓦吉國際機場', 'Chhatrapati Shivaji Maharaj International Airport', '孟買', 'IN', 19.088686, 72.867919, TRUE),
('VOBL', 'BLR', '班加羅爾坎皮高達國際機場', 'Kempegowda International Airport', '班加羅爾', 'IN', 13.198635, 77.706593, TRUE),
('VOMM', 'MAA', '清奈國際機場', 'Chennai International Airport', '清奈', 'IN', 12.990005, 80.169296, TRUE),
('VOHS', 'HYD', '海得拉巴拉吉夫·甘地國際機場', 'Rajiv Gandhi International Airport', '海得拉巴', 'IN', 17.231317, 78.429856, FALSE),
('VGHS', 'DAC', '達卡沙阿賈拉勒國際機場', 'Hazrat Shahjalal International Airport', '達卡', 'BD', 23.843347, 90.397783, FALSE),

-- 5. 北美與拉美主要客貨運樞紐 (34 座)
('KLAX', 'LAX', '洛杉磯國際機場', 'Los Angeles International Airport', '洛杉磯', 'US', 33.942536, -118.408075, TRUE),
('KSFO', 'SFO', '舊金山國際機場', 'San Francisco International Airport', '舊金山', 'US', 37.618972, -122.374889, TRUE),
('KSEA', 'SEA', '西雅圖-塔科馬國際機場', 'Seattle-Tacoma International Airport', '西雅圖', 'US', 47.449000, -122.309306, TRUE),
('KONT', 'ONT', '安大略國際機場', 'Ontario International Airport', '安大略', 'US', 34.056000, -117.601194, TRUE),
('KJFK', 'JFK', '紐約甘迺迪國際機場', 'John F. Kennedy International Airport', '紐約', 'US', 40.639751, -73.778925, TRUE),
('KEWR', 'EWR', '紐華克自由國際機場', 'Newark Liberty International Airport', '紐華克', 'US', 40.692500, -74.168667, TRUE),
('KORD', 'ORD', '芝加哥歐海爾國際機場', 'Chicago OHare International Airport', '芝加哥', 'US', 41.978603, -87.904842, TRUE),
('KDFW', 'DFW', '達拉斯-沃斯堡國際機場', 'Dallas/Fort Worth International Airport', '達拉斯', 'US', 32.896828, -97.037997, TRUE),
('KIAH', 'IAH', '休士頓喬治·布希洲際機場', 'George Bush Intercontinental Airport', '休士頓', 'US', 29.984433, -95.341442, TRUE),
('KATL', 'ATL', '亞特蘭大哈茨菲爾德-傑克遜國際機場', 'Hartsfield-Jackson Atlanta International Airport', '亞特蘭大', 'US', 33.636719, -84.428067, TRUE),
('KMIA', 'MIA', '邁阿密國際機場', 'Miami International Airport', '邁阿密', 'US', 25.793250, -80.290556, TRUE),
('PANC', 'ANC', '安克拉治泰德·史蒂文斯國際機場', 'Ted Stevens Anchorage International Airport', '安克拉治', 'US', 61.174361, -149.996361, TRUE),
('KSDF', 'SDF', '路易維爾穆罕默德·阿里國際機場', 'Louisville Muhammad Ali International Airport', '路易維爾', 'US', 38.174389, -85.736000, TRUE),
('KMEM', 'MEM', '曼菲斯國際機場', 'Memphis International Airport', '曼菲斯', 'US', 35.042417, -89.976667, TRUE),
('KBOS', 'BOS', '波士頓洛根國際機場', 'Boston Logan International Airport', '波士頓', 'US', 42.364347, -71.005181, TRUE),
('KIAD', 'IAD', '華盛頓杜勒斯國際機場', 'Washington Dulles International Airport', '華盛頓', 'US', 38.944533, -77.455808, TRUE),
('KPHX', 'PHX', '鳳凰城天港國際機場', 'Phoenix Sky Harbor International Airport', '鳳凰城', 'US', 33.434278, -112.011583, TRUE),
('KDEN', 'DEN', '丹佛國際機場', 'Denver International Airport', '丹佛', 'US', 39.861656, -104.673178, TRUE),
('KDTW', 'DTW', '底特律都會韋恩郡機場', 'Detroit Metropolitan Wayne County Airport', '底特律', 'US', 42.212444, -83.353389, FALSE),
('KMSP', 'MSP', '明尼阿波利斯-聖保羅國際機場', 'Minneapolis-Saint Paul International Airport', '明尼阿波利斯', 'US', 44.881956, -93.221767, FALSE),
('KLAS', 'LAS', '拉斯維加斯哈里·瑞德國際機場', 'Harry Reid International Airport', '拉斯維加斯', 'US', 36.080056, -115.152250, FALSE),
('KMCO', 'MCO', '奧蘭多國際機場', 'Orlando International Airport', '奧蘭多', 'US', 28.429394, -81.308994, FALSE),
('KPHL', 'PHL', '費城國際機場', 'Philadelphia International Airport', '費城', 'US', 39.871944, -75.241139, FALSE),
('KCLT', 'CLT', '夏洛特道格拉斯國際機場', 'Charlotte Douglas International Airport', '夏洛特', 'US', 35.214000, -80.943139, FALSE),
('KSJC', 'SJC', '聖荷西諾曼·峰田國際機場', ' San Jose Mineta International Airport', '聖荷西', 'US', 37.362600, -121.929022, FALSE),
('KSAN', 'SAN', '聖地牙哥國際機場', 'San Diego International Airport', '聖地牙哥', 'US', 32.733556, -117.189667, FALSE),
('KCVG', 'CVG', '辛辛那提/北肯塔基國際機場', 'Cincinnati/Northern Kentucky International Airport', '辛辛那提', 'US', 39.048836, -84.667822, TRUE),
('PHNL', 'HNL', '檀香山丹尼爾·井上國際機場', 'Daniel K. Inouye International Airport', '檀香山', 'US', 21.318681, -157.922428, FALSE),
('CYVR', 'YVR', '溫哥華國際機場', 'Vancouver International Airport', '溫哥華', 'CA', 49.193889, -123.184444, TRUE),
('CYYZ', 'YYZ', '多倫多皮爾遜國際機場', 'Toronto Pearson International Airport', '多倫多', 'CA', 43.677223, -79.630556, TRUE),
('CYUL', 'YUL', '蒙特婁皮埃爾·艾利奧特·杜魯道國際機場', 'Montreal-Pierre Elliott Trudeau International Airport', '蒙特婁', 'CA', 45.470556, -73.740833, FALSE),
('CYYC', 'YYC', '卡加利國際機場', 'Calgary International Airport', '卡加利', 'CA', 51.113888, -114.020278, FALSE),
('MMMX', 'MEX', '墨西哥城貝尼托·胡亞雷斯國際機場', 'Mexico City International Airport', '墨西哥城', 'MX', 19.436303, -99.072097, TRUE),
('MMGL', 'GDL', '瓜達拉哈拉國際機場', 'Miguel Hidalgo y Costilla Guadalajara International Airport', '瓜達拉哈拉', 'MX', 20.521800, -103.311167, FALSE),

-- 6. 歐洲與中東主要樞紐 (39 座)
('EDDF', 'FRA', '法蘭克福國際機場', 'Frankfurt Airport', '法蘭克福', 'DE', 50.033333, 8.570556, TRUE),
('EDDM', 'MUC', '慕尼黑機場', 'Munich Airport', '慕尼黑', 'DE', 48.353783, 11.786086, TRUE),
('EDDP', 'LEJ', '萊比錫/哈雷機場', 'Leipzig/Halle Airport', '萊比錫', 'DE', 51.423992, 12.236383, TRUE),
('EDDK', 'CGN', '科隆/波昂機場', 'Cologne Bonn Airport', '科隆', 'DE', 50.865917, 7.142744, TRUE),
('EDDB', 'BER', '柏林布蘭登堡機場', 'Berlin Brandenburg Airport', '柏林', 'DE', 52.362247, 13.500672, FALSE),
('EDDH', 'HAM', '漢堡機場', 'Hamburg Airport', '漢堡', 'DE', 53.630389, 9.988228, FALSE),
('EDDL', 'DUS', '杜塞道夫機場', 'Dusseldorf Airport', '杜塞道夫', 'DE', 51.289453, 6.766775, FALSE),
('EHAM', 'AMS', '阿姆斯特丹史基浦機場', 'Amsterdam Airport Schiphol', '阿姆斯特丹', 'NL', 52.308613, 4.763889, TRUE),
('LFPG', 'CDG', '巴黎戴高樂機場', 'Paris Charles de Gaulle Airport', '巴黎', 'FR', 49.012779, 2.550000, TRUE),
('LFPO', 'ORY', '巴黎奧利機場', 'Paris Orly Airport', '巴黎', 'FR', 48.723333, 2.379444, FALSE),
('EGLL', 'LHR', '倫敦希斯洛機場', 'London Heathrow Airport', '倫敦', 'GB', 51.477500, -0.461389, TRUE),
('EGKK', 'LGW', '倫敦蓋威克機場', 'London Gatwick Airport', '倫敦', 'GB', 51.148056, -0.190278, FALSE),
('EGSS', 'STN', '倫敦史坦斯特德機場', 'London Stansted Airport', '倫敦', 'GB', 51.885000, 0.235000, TRUE),
('EGCC', 'MAN', '曼徹斯特機場', 'Manchester Airport', '曼徹斯特', 'GB', 53.353744, -2.274950, FALSE),
('ELLX', 'LUX', '盧森堡芬德爾機場', 'Luxembourg Airport', '盧森堡', 'LU', 49.626575, 6.211517, TRUE),
('EBLG', 'LGG', '列日機場', 'Liege Airport', '列日', 'BE', 50.637417, 5.443222, TRUE),
('EBBR', 'BRU', '布魯塞爾機場', 'Brussels Airport', '布魯塞爾', 'BE', 50.901389, 4.484444, TRUE),
('LIMC', 'MXP', '米蘭馬爾彭薩機場', 'Milan Malpensa Airport', '米蘭', 'IT', 45.630606, 8.728111, TRUE),
('LIRF', 'FCO', '羅馬菲烏米奇諾機場', 'Rome Fiumicino Airport', '羅馬', 'IT', 41.800278, 12.238889, TRUE),
('LSZH', 'ZRH', '蘇黎世機場', 'Zurich Airport', '蘇黎世', 'CH', 47.464722, 8.549167, TRUE),
('LSGG', 'GVA', '日內瓦機場', 'Geneva Airport', '日內瓦', 'CH', 46.238064, 6.108950, FALSE),
('LOWW', 'VIE', '維也納國際機場', 'Vienna International Airport', '維也納', 'AT', 48.110278, 16.569722, TRUE),
('LEMD', 'MAD', '馬德里巴拉哈斯機場', 'Adolfo Suarez Madrid-Barajas Airport', '馬德里', 'ES', 40.471926, -3.562640, TRUE),
('LEBL', 'BCN', '巴塞隆納埃爾普拉特機場', ' Josep Tarradellas Barcelona-El Prat Airport', '巴塞隆納', 'ES', 41.297078, 2.078464, TRUE),
('LPPT', 'LIS', '里斯本溫貝托·德爾加多機場', 'Humberto Delgado Airport', '里斯本', 'PT', 38.781311, -9.135919, FALSE),
('EKCH', 'CPH', '哥本哈根凱斯楚普機場', 'Copenhagen Airport', '哥本哈根', 'DK', 55.617917, 12.655972, TRUE),
('ESSA', 'ARN', '斯德哥爾摩阿蘭達機場', 'Stockholm Arlanda Airport', '斯德哥爾摩', 'SE', 59.651944, 17.918611, TRUE),
('ENGM', 'OSL', '奧斯陸加勒穆恩機場', 'Oslo Airport, Gardermoen', '奧斯陸', 'NO', 60.193917, 11.100361, FALSE),
('EFHK', 'HEL', '赫爾辛基-萬塔機場', 'Helsinki-Vantaa Airport', '赫爾辛基', 'FI', 60.317222, 24.963333, TRUE),
('EPWA', 'WAW', '華沙蕭邦機場', 'Warsaw Chopin Airport', '華沙', 'PL', 52.165750, 20.967122, TRUE),
('LKPR', 'PRG', '布拉格瓦茨拉夫·哈維爾國際機場', 'Vaclav Havel Airport Prague', '布拉格', 'CZ', 50.100833, 14.260000, TRUE),
('LHBP', 'BUD', '布達佩斯李斯特·費倫茨國際機場', 'Budapest Ferenc Liszt International Airport', '布達佩斯', 'HU', 47.436933, 19.255592, TRUE),
('LGAV', 'ATH', '雅典埃萊夫塞里奧斯·韋尼澤洛斯國際機場', 'Athens International Airport', '雅典', 'GR', 37.936358, 23.944467, FALSE),
('EIDW', 'DUB', '都柏林機場', 'Dublin Airport', '都柏林', 'IE', 53.421333, -6.270075, FALSE),
('LTFM', 'IST', '伊斯坦堡機場', 'Istanbul Airport', '伊斯坦堡', 'TR', 41.275278, 28.751944, TRUE),
('OMDB', 'DXB', '杜拜國際機場', 'Dubai International Airport', '杜拜', 'AE', 25.252778, 55.364444, TRUE),
('OMAA', 'AUH', '阿布達比扎耶德國際機場', 'Zayed International Airport', '阿布達比', 'AE', 24.432972, 54.651139, TRUE),
('OTHH', 'DOH', '杜哈amad國際機場', 'Hamad International Airport', '杜哈', 'QA', 25.273056, 51.608056, TRUE),
('OERK', 'RUH', '利雅德哈立德國王國際機場', 'King Khalid International Airport', '利雅德', 'SA', 24.957640, 46.698776, FALSE),

-- 7. 紐澳、大洋洲與其他重點樞紐 (11 座)
('YSSY', 'SYD', '雪梨金斯福德·史密斯機場', 'Sydney Kingsford Smith Airport', '雪梨', 'AU', -33.946111, 151.177222, TRUE),
('YMML', 'MEL', '墨爾本機場', 'Melbourne Airport', '墨爾本', 'AU', -37.673333, 144.843333, TRUE),
('YBBN', 'BNE', '布里斯本機場', 'Brisbane Airport', '布里斯本', 'AU', -27.384167, 153.117500, TRUE),
('YPPH', 'PER', '伯斯機場', 'Perth Airport', '伯斯', 'AU', -31.940278, 115.966944, FALSE),
('YPAD', 'ADL', '阿得雷德機場', 'Adelaide Airport', '阿得雷德', 'AU', -34.945000, 138.530556, FALSE),
('NZAA', 'AKL', '奧克蘭機場', 'Auckland Airport', '奧克蘭', 'NZ', -37.008056, 174.791667, TRUE),
('NZCH', 'CHC', '基督城國際機場', 'Christchurch International Airport', '基督城', 'NZ', -43.489358, 172.532225, FALSE),
('PGUM', 'GUM', '關島安東尼奧·汪帕特國際機場', 'Antonio B. Won Pat International Airport', '關島', 'GU', 13.483450, 144.795983, FALSE),
('SBGR', 'GRU', '聖保羅瓜魯柳斯國際機場', 'Sao Paulo/Guarulhos International Airport', '聖保羅', 'BR', -23.435556, -46.473056, FALSE),
('FAOR', 'JNB', '約翰尼斯堡奧利弗·坦博國際機場', 'O. R. Tambo International Airport', '約翰尼斯堡', 'ZA', -26.139166, 28.246000, FALSE),
('HECA', 'CAI', '開羅國際機場', 'Cairo International Airport', '開羅', 'EG', 30.121944, 31.405556, FALSE)
ON CONFLICT (icao_code) DO NOTHING;

-- 確保所有關鍵樞紐的 is_major_hub 標記為 TRUE
UPDATE airports
SET is_major_hub = TRUE
WHERE iata_code IN (
    'TPE','TSA','KHH','HKG','MFM',
    'PVG','SHA','PEK','PKX','CAN','SZX','XMN','FOC','CKG','CTU','TFU','WUH','NKG','HGH','NGB','WUX','TAO','TSN','DLC','SHE','XIY','CGO','CSX','KMG',
    'NRT','HND','KIX','NGO','FUK','CTS','OKA','ICN','GMP','PUS',
    'SIN','BKK','DMK','KUL','PEN','SGN','HAN','DAD','MNL','CGK','PNH','DEL','BOM','BLR','MAA',
    'LAX','SFO','SEA','ONT','JFK','EWR','ORD','DFW','IAH','ATL','MIA','ANC','SDF','MEM','BOS','IAD','YVR','YYZ','MEX',
    'FRA','MUC','LEJ','CGN','AMS','CDG','LHR','STN','LUX','LGG','BRU','MXP','FCO','ZRH','VIE','MAD','BCN','CPH','ARN','HEL','WAW','PRG','IST','DXB','AUH','DOH',
    'SYD','MEL','BNE','AKL'
);

-- [SECTION_2_RULE_A]
-- 第二部分：規則 A (最高優先級 request_count = 50)
-- 台灣三機場 (TPE/RCTP, KHH/RCKH, TSA/RCSS) 完整雙向航線
WITH tw_tpe_targets AS (
    -- TPE 對所有非台灣之主要國際樞紐
    SELECT icao_code
    FROM airports
    WHERE country_code != 'TW'
      AND is_major_hub = TRUE
),
tw_khh_tsa_targets AS (
    -- KHH 與 TSA 對日韓、大陸港澳、東南亞與核心轉運樞紐
    SELECT icao_code
    FROM airports
    WHERE country_code != 'TW'
      AND (
          country_code IN ('CN', 'HK', 'MO', 'JP', 'KR', 'SG', 'TH', 'MY', 'VN', 'PH', 'ID', 'KH')
          OR iata_code IN ('LAX', 'SFO', 'FRA', 'AMS', 'DXB')
      )
      AND is_major_hub = TRUE
),
modes AS (
    SELECT 'CARGO'::VARCHAR(15) AS transport_mode
    UNION ALL
    SELECT 'PASSENGER'::VARCHAR(15) AS transport_mode
),
rule_a_pairs AS (
    -- 1. TPE 去程與回程
    SELECT 'RCTP' AS origin_icao, t.icao_code AS dest_icao, m.transport_mode
    FROM tw_tpe_targets t CROSS JOIN modes m
    UNION
    SELECT t.icao_code AS origin_icao, 'RCTP' AS dest_icao, m.transport_mode
    FROM tw_tpe_targets t CROSS JOIN modes m
    UNION
    -- 2. KHH 去程與回程
    SELECT 'RCKH' AS origin_icao, t.icao_code AS dest_icao, m.transport_mode
    FROM tw_khh_tsa_targets t CROSS JOIN modes m
    UNION
    SELECT t.icao_code AS origin_icao, 'RCKH' AS dest_icao, m.transport_mode
    FROM tw_khh_tsa_targets t CROSS JOIN modes m
    UNION
    -- 3. TSA 去程與回程
    SELECT 'RCSS' AS origin_icao, t.icao_code AS dest_icao, m.transport_mode
    FROM tw_khh_tsa_targets t CROSS JOIN modes m
    UNION
    SELECT t.icao_code AS origin_icao, 'RCSS' AS dest_icao, m.transport_mode
    FROM tw_khh_tsa_targets t CROSS JOIN modes m
)
INSERT INTO scrape_queue (origin_icao, dest_icao, transport_mode, status, request_count)
SELECT p.origin_icao, p.dest_icao, p.transport_mode, 'PENDING', 50
FROM rule_a_pairs p
WHERE p.origin_icao != p.dest_icao
  AND NOT EXISTS (
      SELECT 1
      FROM icao_routes_cache c
      WHERE c.origin_icao = p.origin_icao
        AND c.dest_icao = p.dest_icao
        AND c.transport_mode = p.transport_mode
  )
ON CONFLICT (origin_icao, dest_icao, transport_mode) DO NOTHING;

-- 將佇列中現有仍為 PENDING 的台灣三機場雙向航線優先級一併提升至至少 50
UPDATE scrape_queue
SET request_count = GREATEST(request_count, 50),
    updated_at = NOW()
WHERE status = 'PENDING'
  AND (origin_icao IN ('RCTP', 'RCKH', 'RCSS') OR dest_icao IN ('RCTP', 'RCKH', 'RCSS'));

-- [SECTION_3_RULE_B]
-- 第三部分：規則 B (次高優先級 request_count = 20)
-- 中國大陸核心製造業機場 + HKG 雙向航線
WITH cn_core_hubs AS (
    SELECT icao_code
    FROM airports
    WHERE iata_code IN (
        'PVG', 'SHA', 'PEK', 'PKX', 'CAN', 'SZX', 'XMN', 'FOC',
        'CKG', 'CTU', 'TFU', 'WUH', 'NKG', 'HGH', 'NGB', 'WUX',
        'TAO', 'TSN', 'DLC', 'SHE', 'XIY', 'CGO', 'CSX', 'KMG',
        'HAK', 'NNG', 'HKG'
    )
),
global_tier1_targets AS (
    SELECT icao_code
    FROM airports
    WHERE iata_code IN (
        -- 台灣三機場
        'TPE', 'KHH', 'TSA',
        -- 全球一線客貨運樞紐 (18 座)
        'LAX', 'SFO', 'ORD', 'JFK', 'ANC',
        'FRA', 'AMS', 'CDG', 'LHR', 'LUX',
        'NRT', 'HND', 'ICN',
        'SIN', 'BKK', 'SGN', 'HAN',
        'DXB'
    )
),
modes AS (
    SELECT 'CARGO'::VARCHAR(15) AS transport_mode
    UNION ALL
    SELECT 'PASSENGER'::VARCHAR(15) AS transport_mode
),
rule_b_pairs AS (
    -- 去程：大陸/香港核心樞紐 -> 台灣三機場 + 全球一線樞紐
    SELECT c.icao_code AS origin_icao, g.icao_code AS dest_icao, m.transport_mode
    FROM cn_core_hubs c
    CROSS JOIN global_tier1_targets g
    CROSS JOIN modes m
    WHERE c.icao_code != g.icao_code
    UNION
    -- 回程：台灣三機場 + 全球一線樞紐 -> 大陸/香港核心樞紐
    SELECT g.icao_code AS origin_icao, c.icao_code AS dest_icao, m.transport_mode
    FROM cn_core_hubs c
    CROSS JOIN global_tier1_targets g
    CROSS JOIN modes m
    WHERE c.icao_code != g.icao_code
)
INSERT INTO scrape_queue (origin_icao, dest_icao, transport_mode, status, request_count)
SELECT p.origin_icao, p.dest_icao, p.transport_mode, 'PENDING', 20
FROM rule_b_pairs p
WHERE p.origin_icao != p.dest_icao
  AND NOT EXISTS (
      SELECT 1
      FROM icao_routes_cache c
      WHERE c.origin_icao = p.origin_icao
        AND c.dest_icao = p.dest_icao
        AND c.transport_mode = p.transport_mode
  )
ON CONFLICT (origin_icao, dest_icao, transport_mode) DO NOTHING;
