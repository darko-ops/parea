/**
 * Wordlist for spoken event codes — docs/design.md §5.
 *
 * System-generated only, never user-chosen: chosen names get squatted within a
 * week and drag in trademark complaints and moderation.
 *
 * Curated for two properties. Every word survives being said out loud across a
 * noisy room, and the two lists are restricted to colours, materials, textures,
 * animals and landscape features so that no pairing can land somewhere
 * unfortunate. Adding a word that is a body part, a slur near-miss, a brand, or
 * a verb breaks the second property — the safety here comes from the narrowness
 * of the categories, not from a blocklist.
 *
 * This is a starting pool of ~18k pairs, not the ~1M the design targets. Codes
 * live in a table and are allocated from it, so growing the pool is an insert,
 * not a code change. Revisit before the number of concurrently active events
 * gets within an order of magnitude of the pool size.
 */

export const ADJECTIVES = [
  'amber', 'arctic', 'ashen', 'autumn', 'azure', 'bamboo', 'basalt', 'birch',
  'bold', 'brass', 'bright', 'bronze', 'calm', 'canvas', 'cedar', 'chalk',
  'cherry', 'chrome', 'cinder', 'citrus', 'clay', 'clever', 'cobalt', 'copper',
  'coral', 'cosmic', 'cotton', 'crimson', 'crystal', 'dawn', 'denim', 'dusty',
  'eager', 'ember', 'emerald', 'fern', 'flint', 'floral', 'foggy', 'frosty',
  'garnet', 'gentle', 'ginger', 'glass', 'golden', 'granite', 'grassy', 'hazel',
  'honey', 'indigo', 'ivory', 'jade', 'jolly', 'juniper', 'kindly', 'lavender',
  'leafy', 'lemon', 'lilac', 'linen', 'lively', 'lunar', 'maple', 'marble',
  'mellow', 'merry', 'midnight', 'minty', 'misty', 'mossy', 'nimble', 'noble',
  'oaken', 'ochre', 'olive', 'onyx', 'opal', 'orchid', 'pastel', 'peach',
  'pearl', 'pebble', 'pewter', 'pine', 'plum', 'polar', 'quartz', 'quiet',
  'rapid', 'reed', 'rosy', 'ruby', 'rustic', 'sage', 'sandy', 'sapphire',
  'scarlet', 'shady', 'silken', 'silver', 'slate', 'snowy', 'solar', 'spruce',
  'starry', 'steady', 'stellar', 'sunny', 'swift', 'teal', 'thistle', 'tidal',
  'topaz', 'tulip', 'umber', 'velvet', 'verdant', 'violet', 'walnut', 'willow',
  'winter', 'woven', 'zesty',
] as const;

export const NOUNS = [
  'acorn', 'anchor', 'antler', 'arrow', 'aspen', 'badger', 'basin', 'beacon',
  'beetle', 'bison', 'blossom', 'bluff', 'bobcat', 'boulder', 'bramble',
  'brook', 'burrow', 'canyon', 'cavern', 'cedar', 'chorus', 'cliff', 'clover',
  'comet', 'compass', 'coral', 'cottage', 'cove', 'crane', 'crest', 'cricket',
  'crow', 'cypress', 'dahlia', 'delta', 'dingo', 'dolphin', 'dune', 'eagle',
  'egret', 'elk', 'ember', 'falcon', 'fawn', 'fennel', 'fern', 'ferry',
  'finch', 'fjord', 'forge', 'fossil', 'fox', 'gale', 'garden', 'gecko',
  'geyser', 'glacier', 'glade', 'gopher', 'grotto', 'grove', 'gull', 'harbor',
  'harvest', 'hawk', 'heron', 'hollow', 'ibex', 'inlet', 'island', 'jackal',
  'jasper', 'jetty', 'kestrel', 'koala', 'lagoon', 'lantern', 'lark', 'ledge',
  'lemur', 'lichen', 'lynx', 'magpie', 'mallard', 'manor', 'marsh', 'meadow',
  'mesa', 'mink', 'minnow', 'moose', 'moth', 'oasis', 'ocelot', 'orchard',
  'osprey', 'otter', 'owl', 'panther', 'parsley', 'pasture', 'pelican', 'pier',
  'pigeon', 'pinecone', 'plateau', 'plover', 'pond', 'prairie', 'puffin',
  'quail', 'quarry', 'rabbit', 'rapids', 'raven', 'reef', 'ridge', 'river',
  'robin', 'salmon', 'sequoia', 'shale', 'sparrow', 'spring', 'summit',
  'swallow', 'thicket', 'thrush', 'tide', 'trout', 'tundra', 'valley', 'vireo',
  'walrus', 'warbler', 'willow', 'wombat', 'wren',
] as const;
