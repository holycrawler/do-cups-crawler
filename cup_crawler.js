import { JSDOM } from "jsdom";
import fetch from "node-fetch";
import fs from "fs";
//import { createInterface } from "readline";
//import json2csv from 'json2csv';

//const rl = createInterface({
//  input: process.stdin,
//  output: process.stdout,
//});

const parseHtml = (text) => {
  const { window } = new JSDOM(text);
  return window.document;
};

const extractClubId = (href) => Number(href.match(/clubid\/(\d+)/)[1]);
const extractGameId = (href) => Number(href.match(/gameid\/(\d+)/)[1]);
const extractCountryAbbreviation = (src) => src.match(/\/([^\/]+)\.png$/)[1];

const extractScores = (text) => {
  const scoreRegEx = /^(\d+)\s*:\s*(\d+)(?:\((\d+)\s*:\s*(\d+)\s*(aet|p)\))?$/;
  const score = text.match(scoreRegEx);
  if (!score) return null;

  const homeScore = Number(score[1]);
  const awayScore = Number(score[2]);
  const extraTimeGoals = score[5] ? Number(score[3]) + Number(score[4]) : null;
  const aetOrPen = score[5] ? score[5] : "regular";

  return { homeScore, awayScore, extraTimeGoals, aetOrPen };
};

const parseMatch = (cupType, seasonNumber, match, isPreliminary, numberOfMatches) => {
  const cupMatchAnchors = match.querySelectorAll("a");
  let homeNat, home, game, away, awayNat, homeFlagEl, awayFlagEl;

  if (cupMatchAnchors.length === 3) {
    [home, game, away] = cupMatchAnchors;
    homeNat = awayNat = cupType;
  } else {
    [homeFlagEl, home, game, away, awayFlagEl] = cupMatchAnchors;
    homeNat = extractCountryAbbreviation(homeFlagEl.firstElementChild.src);
    awayNat = extractCountryAbbreviation(awayFlagEl.firstElementChild.src);
  }

  const { homeScore, awayScore, extraTimeGoals, aetOrPen } = extractScores(game.textContent);

  const finalHomeScore = extraTimeGoals ? homeScore + extraTimeGoals : homeScore;
  const finalAwayScore = extraTimeGoals ? awayScore + extraTimeGoals : awayScore;

  const homeInfo = {
    name: home.textContent.trim(),
    id: extractClubId(home.href),
    nat: homeNat,
    score: homeScore,
    additional_time_goals: extraTimeGoals || "",
    aet_p: aetOrPen,
    winner: finalHomeScore > finalAwayScore,
  };

  const awayInfo = {
    name: away.textContent.trim(),
    id: extractClubId(away.href),
    nat: awayNat,
    score: awayScore,
    additional_time_goals: extraTimeGoals || "",
    aet_p: aetOrPen,
    winner: finalAwayScore > finalHomeScore,
  };

  let round = "";
  switch (true) {
    case isPreliminary:
      round = "P";
      break;
    case numberOfMatches === 4:
      round = "QF";
      break;
    case numberOfMatches === 2:
      round = "SF";
      break;
    case numberOfMatches === 1:
      round = "F";
      break;
    default:
      round = `R${numberOfMatches}`;
  }

  return { cuptype: cupType, season: seasonNumber, round, gameid: extractGameId(game.href), home: homeInfo, away: awayInfo };
};

const parseCupRound = (cupType, seasonNumber, doc) => {
  const gamesElems = doc.querySelectorAll("div[class*='cup_match_']");
  const isPreliminary = !!doc.querySelector("#competition_wrapper center");
  const roundCounts = [...gamesElems];

  return roundCounts.map((match) => parseMatch(cupType, seasonNumber, match, isPreliminary, roundCounts.length));
};

const parseCupSeason = async (cupType, competitionId, seasonNumber) => {
  const seasonData = [];
  const fetches = [];

  const firstRoundURL = `https://www.dugout-online.com/competitions/none/selectedCountryABB/${cupType}/selectedCompetitionID/${competitionId}/selectedDivisionID/0/currentRound/1/seasonNR/${seasonNumber}`;
  const firstRound = await fetch(firstRoundURL);
  const firstRoundText = await firstRound.text();
  const firstRoundDoc = parseHtml(firstRoundText);
  const roundsNumber = firstRoundDoc.querySelector("select[name=selectRound]").options.length;

  if (roundsNumber === 1) return `cup data unavailable for ${cupType}/${competitionId} season ${seasonNumber}`;

  seasonData.push(...parseCupRound(cupType, seasonNumber, firstRoundDoc));

  for (let round = 2; round <= roundsNumber; round++) {
    const cupURL = `https://www.dugout-online.com/competitions/none/selectedCountryABB/${cupType}/selectedCompetitionID/${competitionId}/selectedDivisionID/0/currentRound/${round}/seasonNR/${seasonNumber}`;
    fetches.push(
      fetch(cupURL)
        .then((response) => response.text())
        .then((text) => {
          const doc = parseHtml(text);
          seasonData.push(...parseCupRound(cupType, seasonNumber, doc));
        })
    );
  }

  await Promise.all(fetches);
  return seasonData;
};

const parseCupData = async (cupType, competitionId, seasonStart, seasonEnd) => {
  const cupData = [];
  for (let season = seasonStart; season <= seasonEnd; season++) {
    cupData.push(...(await parseCupSeason(cupType, competitionId, season)));
  }
  return cupData;
};

const flattenCupDatacupData = (cupData) => {
  return cupData.map((item) => ({
    cuptype: item.cuptype,
    season: item.season,
    round: item.round,
    gameid: item.gameid,
    'home.name': item.home.name,
    'home.id': item.home.id,
    'home.nat': item.home.nat,
    'home.score': item.home.score,
    'home.additional_time_goals': item.home.additional_time_goals,
    'home.aet_p': item.home.aet_p,
    'home.winner': item.home.winner,
    'away.name': item.away.name,
    'away.id': item.away.id,
    'away.nat': item.away.nat,
    'away.score': item.away.score,
    'away.additional_time_goals': item.away.additional_time_goals,
    'away.aet_p': item.away.aet_p,
    'away.winner': item.away.winner,
  }));
};

// Run the function and save the output to a JSON file
//rl.question("Enter cup type (challenge or champions or NAT): ", (cupType) => {
//  rl.question("Enter competition ID (0 if challenge and champions): ", (competitionId) => {
//    rl.question("Enter start season: ", (seasonStart) => {
//      rl.question("Enter end season: ", (seasonEnd) => {
//        // Call parseCupData function with user input
//        parseCupData(cupType, competitionId, seasonStart, seasonEnd)
//          .then((cupData) => {
//            fs.writeFileSync(`${cupType}_from${seasonStart}_to${seasonEnd}.json`, JSON.stringify(cupData, null, 2));
//            const flatcCupData = flattenCupDatacupData(cupData)
//            const csv = json2csv.parse(flatcCupData);
//            fs.writeFileSync(`${cupType}_from${seasonStart}_to${seasonEnd}.csv`, csv, 'utf-8');
//            console.log("Cup data saved to cupData.json");
//            rl.close();
//          })
//          .catch((error) => {
//            console.error("Error:", error);
//            // Close readline interface
//            rl.close();
//          });
//      });
//    });
//  });
//});

parseCupData("challenge", 0, 22, 23)
  .then((data) => {
    fs.writeFileSync('cupData.json', JSON.stringify(data, null, 2));
    console.log("Cup data saved to cupData.json");
  })
  .catch((error) => console.error("Error:", error));
