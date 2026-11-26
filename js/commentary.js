/* Commentary templates. {a} = main player, {b} = second player, {t} = team, {ot} = other team, {p} = percent */
(function (G) {
  'use strict';
  const FB = G.FB || (G.FB = {});
  const T = {
    kickoff: ['{t} get us under way.', 'And we are off — {t} kick off.', 'The whistle goes, {t} start.'],
    kickoff2: ['The second half is under way.', 'We go again — second half, {t} kick off.'],
    restartGoal: ['{t} restart, needing a response.', 'Kick-off again. {t} must react.'],
    pass: ['{a} finds {b}.', '{a} to {b}.', 'Neat from {a}, into {b}.', '{a} moves it on to {b}.', 'Simple ball, {a} to {b}.'],
    passBack: ['{a} recycles it back to {b}.', 'Patient from {a}, back to {b}.', '{a} resets with {b}.'],
    passProg: ['{a} breaks a line — lovely ball into {b}!', 'Sharp pass from {a}, {b} receives between the lines.', '{a} threads it into {b}.'],
    intercepted: ['Cut out by {b}!', '{b} reads it and steps in.', 'Intercepted! {b} was waiting for that.', '{b} gets a foot in the lane.'],
    misplaced: ['{a} overhits it.', 'Loose from {a}, that one gets away.', 'Poor ball from {a}.'],
    badTouch: ['{a} cannot control it under pressure!', 'Heavy touch from {a}.', '{a} is crowded out on the receive.'],
    through: ['What a ball from {a}! {b} is in behind!', '{a} splits the defence — {b} is through!', 'Through ball, {a} for {b} — he is away!'],
    throughLost: ['{a} tries to slip {b} in, but {c} gets there first.', 'Too heavy for {b}, {c} mops up.', '{c} wins the race to it.'],
    throughGk: ['The keeper {c} races out and claims it!', 'Sweeper-keeper {c} gets there first!'],
    offside: ['The flag is up! {b} was offside.', 'Offside — {b} mistimed the run.', 'Flag goes up against {b}. The trap worked.'],
    lob: ['{a} goes long for {b}.', 'Diagonal from {a} — {b} brings it down.', 'Switch of play by {a}, picked up by {b}.'],
    lobLost: ['{a} goes long, {c} wins it in the air.', '{c} heads it away.', 'Long ball from {a}, cleared by {c}.'],
    cross: ['{a} whips it in...', 'Cross from {a}...', '{a} swings in a delivery...'],
    crossClaim: ['{c} comes and claims it confidently.', 'Keeper {c} plucks it out of the air.'],
    crossCleared: ['{c} rises and clears!', 'Headed away by {c}.', '{c} gets there first and clears.'],
    header: ['{b} rises highest — header!', '{b} attacks it — gets his head on it!'],
    dribble: ['{a} drives forward.', '{a} carries it into space.', '{a} runs at them.', '{a} brings it forward.'],
    dribblePast: ['Lovely feet from {a}, past {c}!', '{a} skips away from {c}!', '{a} leaves {c} for dead!', 'Through the challenge from {c} — {a} is away!'],
    counter: ['{t} break at speed! {a} leads the counter.', 'Turnover — and {t} go! {a} is away.', '{a} wins it and {t} spring forward!', 'Counter-attack! {a} looks up.'],
    throughSpace: ['{a} plays it into space for {b}.', '{a} slides {b} into the channel.', '{a} finds {b} running into space.'],
    dribbleTk: ['Strong tackle from {c}, dispossesses {a}.', '{c} stands up and wins it cleanly.', '{a} runs into {c} and loses it.'],
    loseTouch: ['{a} knocks it too far.', 'The ball runs away from {a}.'],
    tackleWon: ['Brilliant tackle by {c}!', '{c} flies in and wins it!', 'Ball won! {c} with a perfectly timed challenge.'],
    tackleBeat: ['{c} dives in... and {a} skips past him!', '{a} rides the challenge from {c}.', '{c} lunges and misses — {a} is free!'],
    run_behind: ['{a} darts in behind.', '{a} goes on the run beyond the defence.', '{b} looks up as {a} makes the run in behind.'],
    run_overlap: ['{a} overlaps on the outside.', '{a} bombs on past {b}.', 'Overlapping run from {a}.'],
    run_short: ['{a} comes short to help {b}.', '{a} drops in to show for it.', '{a} offers {b} a short option.'],
    coverSlide: ['{c} slides across to {b}.', '{c} reads it and shuffles over to {b}.', '{c} gets goal-side of {b}.'],
    foul: ['Foul by {c} on {a}.', '{c} clips {a}. Free kick.', 'The referee blows — {c} was late on {a}.'],
    penalty: ['PENALTY! {c} brings down {a} in the box!', 'The referee points to the spot! {c} has fouled {a}!'],
    yellow: ['Yellow card for {c}.', '{c} goes into the book.'],
    red: ['RED CARD! {c} is sent off!', 'Second yellow — {c} has to go!'],
    shotDriven: ['{a} leathers it!', '{a} drills one at goal!', '{a} hits it with everything!'],
    shotChip: ['{a} tries to chip the keeper!', '{a} dinks it over...', 'Cheeky from {a}: a chip!'],
    shot: ['{a} shoots!', '{a} lets fly!', '{a} has a go!', '{a} pulls the trigger!'],
    goal: ['GOAL! {a} scores for {t}!', 'GOAL!! {a} finds the net!', 'IT\'S IN! {a}!', 'GOAL! What a finish from {a}!'],
    goalLate: ['GOAL! LATE DRAMA! {a} has done it for {t}!', 'GOAL!!! In the dying moments — {a}!'],
    goalEqualiser: ['GOAL! {a} levels it up!', 'GOAL! {t} are back on terms through {a}!'],
    saved: ['Saved by {c}!', 'Good stop from {c}.', '{c} gets down well to save.', 'Straight at {c}.'],
    parried: ['{c} parries it away!', 'Fingertip save by {c}! Corner.', '{c} pushes it round the post!'],
    rebound: ['{c} can only parry — it is loose in the box!', 'Spilled by {c}! Danger!'],
    blocked: ['Blocked by {c}!', '{c} throws himself in the way!', 'Charged down by {c}.'],
    wide: ['Wide.', 'Over the bar.', 'Dragged wide of the post.', 'Off target — goal kick.', 'Just wide! So close.'],
    nearMiss: ['Inches wide! So close!', 'Off the post!', 'Agonisingly wide!'],
    corner: ['Corner to {t}.', '{t} win a corner.'],
    throwin: ['Throw-in, {t}.', 'Out for a throw, {t}.'],
    goalkick: ['Goal kick.', 'Goal kick to {t}.'],
    freekick: ['Free kick to {t}.'],
    penScored: ['PENALTY SCORED! {a} sends the keeper the wrong way!', '{a} buries the penalty!'],
    penSaved: ['SAVED! {c} guesses right and keeps it out!', 'The penalty is saved by {c}!'],
    penMissed: ['{a} has missed! The penalty is wide!', 'Over the bar from the spot!'],
    clear: ['{a} hoofs it clear.', '{a} launches it upfield.', 'No messing about — {a} clears.'],
    loose: ['Loose ball... {a} picks it up for {t}.', 'It breaks for {a}.', 'Scramble — {a} comes away with it.'],
    added: ['The fourth official shows {p} added minutes.', 'There will be {p} minutes of stoppage time.'],
    lastAttack: ['Time is up, but the referee lets {t} finish this attack.', 'The whistle is in his mouth... {t} have one last chance.', 'Last attack for {t}!'],
    halftime: ['Half-time. {p}.', 'The referee blows for the break. {p}.'],
    fulltime: ['FULL TIME! {p}.', 'That is it — the final whistle! {p}.'],
    pressure: ['{t} are piling on the pressure.', 'All {t} at the moment.'],
  };
  let k = 0;
  FB.say = function (key, ctx) {
    const arr = T[key];
    if (!arr) return key;
    k = (k * 7 + 3 + (ctx && ctx.seed ? ctx.seed : 0)) % 9973;
    const s = arr[k % arr.length];
    return s.replace(/\{(\w+)\}/g, (_, n) => (ctx && ctx[n] != null ? ctx[n] : ''));
  };
})(typeof window !== 'undefined' ? window : globalThis);
