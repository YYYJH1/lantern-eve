import { parseScene, type Scene } from "../../src/page/scene.ts";

/** The scene of the bridge town as the core sends it (`Game.scene_json()`), cut down to what the tests of the map and of the festival night read: the terrain, the buildings, the places and the cast. */
export const TOWN_SCENE_RAW = {
 "scenario": "bridge",
 "name": {
  "en": "Chengxi Town",
  "zh": "澄溪镇"
 },
 "width": 56,
 "height": 34,
 "layers": {
  "barriers": [
   {
    "cells": [
     [
      55,
      20
     ],
     [
      55,
      21
     ]
    ],
    "closed": "#",
    "en": "Lane blocked by junk",
    "id": "lane_barrier",
    "open": ":",
    "place": "p_temple_lane",
    "zh": "杂物堵住的夹道口"
   }
  ],
  "buildings": [
   {
    "kind": "house",
    "place": "p_li_house",
    "rect": [
     2,
     2,
     5,
     3
    ]
   },
   {
    "kind": "house",
    "place": "p_li_house",
    "rect": [
     9,
     2,
     5,
     3
    ]
   },
   {
    "kind": "school",
    "place": "p_school",
    "rect": [
     16,
     2,
     6,
     3
    ]
   },
   {
    "kind": "house",
    "place": "p_accountant_home",
    "rect": [
     17,
     9,
     4,
     3
    ]
   },
   {
    "kind": "post",
    "place": "p_watch_post",
    "rect": [
     21,
     12,
     3,
     2
    ]
   },
   {
    "kind": "market",
    "place": "p_market",
    "rect": [
     16,
     19,
     2,
     1
    ]
   },
   {
    "kind": "market",
    "place": "p_market",
    "rect": [
     20,
     19,
     2,
     1
    ]
   },
   {
    "kind": "market",
    "place": "p_market",
    "rect": [
     16,
     22,
     2,
     1
    ]
   },
   {
    "kind": "market",
    "place": "p_market",
    "rect": [
     20,
     22,
     2,
     1
    ]
   },
   {
    "kind": "workshop",
    "place": "p_workshop",
    "rect": [
     2,
     18,
     7,
     3
    ]
   },
   {
    "kind": "house",
    "place": "p_carpenter_home",
    "rect": [
     2,
     25,
     4,
     3
    ]
   },
   {
    "kind": "house",
    "place": "p_xiaoman_home",
    "rect": [
     8,
     25,
     3,
     3
    ]
   },
   {
    "kind": "teahouse",
    "place": "p_teahouse",
    "rect": [
     31,
     10,
     7,
     4
    ]
   },
   {
    "kind": "house",
    "place": "p_zhou_house",
    "rect": [
     31,
     2,
     5,
     3
    ]
   },
   {
    "kind": "house",
    "place": "p_zhou_house",
    "rect": [
     38,
     2,
     5,
     3
    ]
   },
   {
    "kind": "tavern",
    "place": "p_tavern",
    "rect": [
     32,
     18,
     6,
     3
    ]
   },
   {
    "kind": "hall",
    "place": "p_clan_hall",
    "rect": [
     47,
     9,
     8,
     4
    ]
   },
   {
    "kind": "temple",
    "place": "p_temple",
    "rect": [
     47,
     19,
     7,
     4
    ]
   },
   {
    "kind": "house",
    "place": "p_he_home",
    "rect": [
     35,
     29,
     4,
     3
    ]
   }
  ],
  "terrain": {
   "legend": [
    {
     "char": "~",
     "cost": 0,
     "en": "River",
     "id": "river",
     "zh": "河水"
    },
    {
     "char": "=",
     "cost": 1,
     "en": "Bridge deck",
     "id": "bridge",
     "zh": "石桥桥面"
    },
    {
     "char": ",",
     "cost": 1,
     "en": "Bluestone street",
     "id": "street",
     "zh": "青石街"
    },
    {
     "char": ":",
     "cost": 2,
     "en": "Lane",
     "id": "lane",
     "zh": "夹道"
    },
    {
     "char": ".",
     "cost": 3,
     "en": "Grass",
     "id": "grass",
     "zh": "草地"
    },
    {
     "char": ";",
     "cost": 2,
     "en": "Gravel bank",
     "id": "bank",
     "zh": "河滩"
    },
    {
     "char": "w",
     "cost": 1,
     "en": "Pier planks",
     "id": "pier",
     "zh": "码头栈板"
    },
    {
     "char": "#",
     "cost": 0,
     "en": "Wall or tree",
     "id": "wall",
     "zh": "墙与树"
    },
    {
     "char": "H",
     "cost": 0,
     "en": "Building footprint",
     "id": "building",
     "zh": "房屋"
    }
   ],
   "rows": [
    ".........................~~~~...........................",
    ".........................~~~~...........................",
    "..HHHHH,,HHHHH..HHHHHH...~~~~..HHHHH,,HHHHH.............",
    "..HHHHH,,HHHHH,.HHHHHH...~~~~..HHHHH,,HHHHH.,...........",
    "..HHHHH,,HHHHH,.HHHHHH..#~~~~..HHHHH,,HHHHH.,...###.....",
    "..,,,,,,,,,,,,,,,,,,,,...~~~~..,,,,,,,,,,,,,,.##...#.#..",
    "..,,,,,,,,,,,,,,,,,,,,#..~~~~..,,,,,,,,,,,,,,.........#.",
    "..,,,,,,,,,,,,,........#.~~~~..,,,,,,,,,,,,,,...........",
    "..............,........#.~~~~...............,...........",
    "..............,..HHHH....~~~~...............,..HHHHHHHH.",
    ".##.......##..,..HHHH....~~~~..HHHHHHH##.#..,..HHHHHHHH.",
    ".#....##...#..,..HHHH....~~~~..HHHHHHH..##..,..HHHHHHHH.",
    "..............,...,,.HHH.~~~~..HHHHHHH......,..HHHHHHHH.",
    "....##........,...,..HHH.~~~~..HHHHHHH......,,,,,,,,,,,.",
    "..............,,,,,,,,,,,~~~~.,,,,,,,,,.....,,,,,,,,,,,.",
    ",,,,,,,,,,,,,,,,,,,,,,,,======,,,,,,,,,,,,,,,,,,,,,,,,,,",
    ",,,,,,,,,,,,,,,,,,,,,,,,======,,,,,,,,,,,,,,,,,,,,,,,,,,",
    "..............,,,,,,,,,,.~~~~.,,,,,,,,,.....,,,,,,,,,,,:",
    "..HHHHHHH.....,,,,,,,,,,.~~~~.,.HHHHHH......,,,,,,,,,,,:",
    "..HHHHHHH.....,,HH,,HH,,.~~~~.,.HHHHHH......,..HHHHHHH.:",
    "..HHHHHHH.....,,,,,,,,,,.~~~~.,.HHHHHH..##..,..HHHHHHH.#",
    "..,,,,,,,.....,,,,,,,,,,.~~~~.,..........#..,..HHHHHHH.#",
    "..,,,,,,,,,,,,,,HH,,HH,,..~~~~,.......#.....,..HHHHHHH.:",
    "..............,,,,,,,,,,..~~~~,.............,..........:",
    "..............,.....;;;;;;~~~~,....##.......,:::::::::::",
    "..HHHH..HHH...,.##..;;;;;;~~~~,.....#.......,...........",
    "..HHHH..HHH...,..#..;;;;;;~~~~,.............,...........",
    "..HHHH..HHH...,,,,,,;;;;;;~~~~,.........##..,...........",
    "...,,,,,,,,,,,,.....;;;;;;~~~~,..........#..,....##.....",
    "..............,.....;;;;;;~~ww,....HHHH.....,.....#.....",
    ".#..........##,.....;;;;;;~~~~,,,,,HHHH.....,...........",
    ".....##......#,.....;;;;;;~~~~,....HHHH.....,.......##..",
    "..........................~~~~,.............,........#..",
    "........###...............~~~~......##.................."
   ]
  }
 },
 "places": [
  {
   "cells": [],
   "door": [
    7,
    5
   ],
   "en": "Li Family House",
   "id": "p_li_house",
   "indoor": true,
   "kind": "house",
   "rect": [
    2,
    2,
    13,
    6
   ],
   "stands": [
    [
     3,
     6
    ],
    [
     5,
     6
    ],
    [
     7,
     7
    ],
    [
     10,
     6
    ],
    [
     12,
     6
    ]
   ],
   "zh": "李家宅"
  },
  {
   "cells": [],
   "door": [
    18,
    5
   ],
   "en": "Village School",
   "id": "p_school",
   "indoor": true,
   "kind": "school",
   "rect": [
    16,
    2,
    6,
    5
   ],
   "stands": [
    [
     16,
     5
    ],
    [
     17,
     6
    ],
    [
     19,
     6
    ],
    [
     20,
     5
    ],
    [
     21,
     6
    ]
   ],
   "zh": "私塾"
  },
  {
   "cells": [],
   "door": [
    18,
    12
   ],
   "en": "Accountant's House",
   "id": "p_accountant_home",
   "indoor": true,
   "kind": "house",
   "rect": [
    17,
    9,
    4,
    4
   ],
   "stands": [
    [
     19,
     12
    ]
   ],
   "zh": "账房家"
  },
  {
   "cells": [],
   "door": [
    22,
    14
   ],
   "en": "Watch Post",
   "id": "p_watch_post",
   "indoor": true,
   "kind": "post",
   "rect": [
    21,
    12,
    3,
    3
   ],
   "stands": [
    [
     21,
     14
    ],
    [
     23,
     14
    ]
   ],
   "zh": "更铺"
  },
  {
   "cells": [],
   "door": [
    19,
    20
   ],
   "en": "Market",
   "id": "p_market",
   "indoor": false,
   "kind": "market",
   "rect": [
    15,
    17,
    9,
    7
   ],
   "stands": [
    [
     15,
     19
    ],
    [
     18,
     19
    ],
    [
     19,
     19
    ],
    [
     22,
     19
    ],
    [
     15,
     22
    ],
    [
     18,
     22
    ],
    [
     19,
     22
    ],
    [
     22,
     22
    ]
   ],
   "zh": "集市"
  },
  {
   "cells": [],
   "door": [
    5,
    21
   ],
   "en": "Lantern Workshop",
   "id": "p_workshop",
   "indoor": true,
   "kind": "workshop",
   "rect": [
    2,
    18,
    7,
    5
   ],
   "stands": [
    [
     3,
     21
    ],
    [
     4,
     22
    ],
    [
     6,
     22
    ],
    [
     7,
     21
    ],
    [
     5,
     22
    ]
   ],
   "zh": "扎灯坊"
  },
  {
   "cells": [],
   "door": [
    3,
    28
   ],
   "en": "Carpenter's House",
   "id": "p_carpenter_home",
   "indoor": true,
   "kind": "house",
   "rect": [
    2,
    25,
    4,
    4
   ],
   "stands": [
    [
     4,
     28
    ]
   ],
   "zh": "木匠家"
  },
  {
   "cells": [],
   "door": [
    9,
    28
   ],
   "en": "Xiaoman's House",
   "id": "p_xiaoman_home",
   "indoor": true,
   "kind": "house",
   "rect": [
    8,
    25,
    3,
    4
   ],
   "stands": [
    [
     10,
     28
    ]
   ],
   "zh": "小满家"
  },
  {
   "cells": [],
   "door": [
    23,
    27
   ],
   "en": "Riverbank",
   "id": "p_riverbank",
   "indoor": false,
   "kind": "bank",
   "rect": [
    20,
    24,
    6,
    8
   ],
   "stands": [
    [
     21,
     26
    ],
    [
     24,
     25
    ],
    [
     22,
     29
    ],
    [
     25,
     30
    ],
    [
     21,
     31
    ]
   ],
   "zh": "河滩"
  },
  {
   "cells": [],
   "door": [
    34,
    14
   ],
   "en": "Teahouse",
   "id": "p_teahouse",
   "indoor": true,
   "kind": "teahouse",
   "rect": [
    31,
    10,
    7,
    5
   ],
   "stands": [
    [
     31,
     14
    ],
    [
     32,
     14
    ],
    [
     33,
     14
    ],
    [
     35,
     14
    ],
    [
     36,
     14
    ],
    [
     37,
     14
    ]
   ],
   "zh": "茶馆"
  },
  {
   "cells": [],
   "door": [
    36,
    5
   ],
   "en": "Zhou Family House",
   "id": "p_zhou_house",
   "indoor": true,
   "kind": "house",
   "rect": [
    31,
    2,
    13,
    6
   ],
   "stands": [
    [
     32,
     6
    ],
    [
     34,
     6
    ],
    [
     39,
     6
    ],
    [
     41,
     6
    ],
    [
     43,
     6
    ]
   ],
   "zh": "周家宅"
  },
  {
   "cells": [],
   "door": [
    34,
    17
   ],
   "en": "Tavern",
   "id": "p_tavern",
   "indoor": true,
   "kind": "tavern",
   "rect": [
    32,
    17,
    6,
    4
   ],
   "stands": [
    [
     32,
     17
    ],
    [
     33,
     17
    ],
    [
     35,
     17
    ],
    [
     36,
     17
    ]
   ],
   "zh": "酒肆"
  },
  {
   "cells": [],
   "door": [
    50,
    13
   ],
   "en": "Ancestral Hall",
   "id": "p_clan_hall",
   "indoor": true,
   "kind": "hall",
   "rect": [
    47,
    9,
    8,
    6
   ],
   "stands": [
    [
     47,
     13
    ],
    [
     49,
     13
    ],
    [
     51,
     13
    ],
    [
     53,
     13
    ],
    [
     48,
     14
    ],
    [
     52,
     14
    ]
   ],
   "zh": "祠堂"
  },
  {
   "cells": [],
   "door": [
    50,
    18
   ],
   "en": "Temple",
   "id": "p_temple",
   "indoor": true,
   "kind": "temple",
   "rect": [
    47,
    17,
    8,
    6
   ],
   "stands": [
    [
     47,
     18
    ],
    [
     48,
     17
    ],
    [
     52,
     17
    ],
    [
     53,
     18
    ],
    [
     49,
     17
    ]
   ],
   "zh": "庙"
  },
  {
   "cells": [
    [
     45,
     24
    ],
    [
     46,
     24
    ],
    [
     47,
     24
    ],
    [
     48,
     24
    ],
    [
     49,
     24
    ],
    [
     50,
     24
    ],
    [
     51,
     24
    ],
    [
     52,
     24
    ],
    [
     53,
     24
    ],
    [
     54,
     24
    ],
    [
     55,
     24
    ],
    [
     55,
     17
    ],
    [
     55,
     18
    ],
    [
     55,
     19
    ],
    [
     55,
     20
    ],
    [
     55,
     21
    ],
    [
     55,
     22
    ],
    [
     55,
     23
    ]
   ],
   "door": [
    50,
    24
   ],
   "en": "Lane Behind the Temple",
   "id": "p_temple_lane",
   "indoor": false,
   "kind": "lane",
   "rect": [
    45,
    17,
    11,
    8
   ],
   "stands": [
    [
     47,
     24
    ],
    [
     49,
     24
    ],
    [
     52,
     24
    ],
    [
     54,
     24
    ]
   ],
   "zh": "庙后夹道"
  },
  {
   "cells": [],
   "door": [
    34,
    30
   ],
   "en": "Boatman He's House",
   "id": "p_he_home",
   "indoor": true,
   "kind": "house",
   "rect": [
    34,
    29,
    5,
    3
   ],
   "stands": [
    [
     34,
     29
    ],
    [
     34,
     31
    ]
   ],
   "zh": "老何家"
  },
  {
   "cells": [],
   "door": [
    30,
    29
   ],
   "en": "Ferry Landing",
   "id": "p_ferry",
   "indoor": false,
   "kind": "ferry",
   "rect": [
    28,
    28,
    5,
    4
   ],
   "stands": [
    [
     29,
     29
    ],
    [
     28,
     29
    ],
    [
     31,
     28
    ],
    [
     31,
     31
    ],
    [
     30,
     31
    ]
   ],
   "zh": "渡口"
  },
  {
   "cells": [],
   "door": [
    27,
    15
   ],
   "en": "Stone Bridge",
   "id": "p_bridge",
   "indoor": false,
   "kind": "bridge",
   "rect": [
    24,
    15,
    6,
    2
   ],
   "stands": [
    [
     25,
     16
    ],
    [
     26,
     15
    ],
    [
     28,
     16
    ],
    [
     29,
     15
    ],
    [
     24,
     16
    ],
    [
     27,
     16
    ]
   ],
   "zh": "石桥"
  },
  {
   "cells": [],
   "door": null,
   "en": "Water Beneath the Bridge",
   "id": "p_under_bridge",
   "indoor": false,
   "kind": "water",
   "rect": [
    25,
    17,
    4,
    3
   ],
   "stands": [],
   "zh": "桥下的水面"
  }
 ],
 "families": [
  {
   "en": "Li family",
   "id": "fam_li",
   "zh": "李家"
  },
  {
   "en": "Zhou family",
   "id": "fam_zhou",
   "zh": "周家"
  }
 ],
 "time": {
  "cycle_ticks": 2070,
  "dawn_hour": 6,
  "day_ticks": 1800,
  "day_ticks_per_hour": 120,
  "days": 5,
  "dusk_hour": 21,
  "night_ticks": 270,
  "night_ticks_per_hour": 30
 },
 "cast": [
  {
   "id": "li_laotai",
   "zh": "李老太",
   "en": "Granny Li",
   "family": "fam_li"
  },
  {
   "id": "li_da",
   "zh": "李大",
   "en": "Li Da",
   "family": "fam_li"
  },
  {
   "id": "li_er",
   "zh": "李二",
   "en": "Li Er",
   "family": "fam_li"
  },
  {
   "id": "shitou",
   "zh": "石头",
   "en": "Shitou",
   "family": "fam_li"
  },
  {
   "id": "li_xiaomei",
   "zh": "李家小妹",
   "en": "Li Xiaomei",
   "family": "fam_li"
  },
  {
   "id": "zhou_zhanggui",
   "zh": "周掌柜",
   "en": "Shopkeeper Zhou",
   "family": "fam_zhou"
  },
  {
   "id": "zhou_niangzi",
   "zh": "周娘子",
   "en": "Madam Zhou",
   "family": "fam_zhou"
  },
  {
   "id": "zhou_dalang",
   "zh": "周家大郎",
   "en": "Zhou Dalang",
   "family": "fam_zhou"
  },
  {
   "id": "zhou_erlang",
   "zh": "周家二郎",
   "en": "Zhou Erlang",
   "family": "fam_zhou"
  },
  {
   "id": "zhou_huoji",
   "zh": "周家伙计",
   "en": "Zhou's Clerk",
   "family": "fam_zhou"
  },
  {
   "id": "cha_laoban",
   "zh": "茶馆老板娘",
   "en": "Teahouse Keeper",
   "family": null
  },
  {
   "id": "sishu_xiansheng",
   "zh": "私塾先生",
   "en": "Schoolmaster",
   "family": null
  },
  {
   "id": "old_he",
   "zh": "船夫老何",
   "en": "Boatman He",
   "family": null
  },
  {
   "id": "zuzhang",
   "zh": "族长",
   "en": "Clan Elder",
   "family": null
  },
  {
   "id": "zhangfang",
   "zh": "账房",
   "en": "Accountant",
   "family": null
  },
  {
   "id": "miaozhu",
   "zh": "庙祝",
   "en": "Temple Keeper",
   "family": null
  },
  {
   "id": "xiao_man",
   "zh": "小满",
   "en": "Xiaoman",
   "family": null
  },
  {
   "id": "gengfu",
   "zh": "更夫",
   "en": "Night Watchman",
   "family": null
  },
  {
   "id": "mujiang",
   "zh": "木匠",
   "en": "Carpenter",
   "family": null
  },
  {
   "id": "zhadeng_shifu",
   "zh": "扎灯师傅",
   "en": "Lantern Maker",
   "family": null
  }
 ],
 "player": {
  "id": "player",
  "zh": "总管",
  "en": "Festival Manager",
  "start": [
   27,
   15
  ]
 }
} as const;

export const TOWN_SCENE: Scene = parseScene(JSON.parse(JSON.stringify(TOWN_SCENE_RAW)) as Record<string, unknown>);
