// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FlapSharedIndexerV1} from "./FlapSharedIndexerV1.sol";

/// @title BuilderQuiz
/// @notice On-chain record of "Are You a Real Builder?" quiz results. No funds move through
///         this contract — it only records course completions, XP, and a public leaderboard
///         via the Flap Shared Indexer (FSI). There is no payout: XP is bragging rights only.
/// @dev Trust model: a course result (correctAnswers / totalQuestions) is self-reported by the
///      caller. The quiz content itself (questions, correct answers) lives off-chain in the
///      Flap App UI, same as the public site's quiz. Since nothing of value is at stake, this
///      contract does not attempt to cryptographically verify that a caller actually played —
///      only that XP can't be farmed twice for the same course (see `courseCompleted`).
contract BuilderQuiz is FlapSharedIndexerV1 {
    bytes32 constant NS_XP = "xp";           // Template A -> global leaderboard
    bytes32 constant NS_COURSE = "course";   // Template B -> per-course leaderboard (round = courseId)
    bytes32 constant NS_ATTEMPT = "attempt"; // Template G -> activity feed, one row per attempt

    /// @notice XP awarded per correct answer. Tunable by the owner, never retroactive.
    uint256 public xpPerCorrectAnswer = 100;

    /// @notice XP required per level. Pure view math, not stored per user.
    uint256 public xpPerLevel = 1000;

    /// @notice Hard cap on questions per course, to keep inputs sane.
    uint256 public constant MAX_QUESTIONS_PER_COURSE = 100;

    address public owner;

    /// @notice Lifetime XP per address. Source of truth for the global leaderboard.
    mapping(address => uint256) public xp;

    /// @notice Best score (basis points, 0-10000) per user per course.
    mapping(uint256 => mapping(address => uint256)) public courseScore;

    /// @notice Whether a user has already banked XP for a given course (first clear only).
    mapping(uint256 => mapping(address => bool)) public courseCompleted;

    event CourseAttempt(address indexed user, uint256 indexed courseId, uint256 scoreBps, uint256 xpAwarded);
    event XpPerCorrectAnswerUpdated(uint256 oldValue, uint256 newValue);
    event XpPerLevelUpdated(uint256 oldValue, uint256 newValue);
    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Record a finished quiz run for `courseId`.
    /// @dev XP is only credited the first time a user clears a given course, so repeat plays
    ///      (to practice, or to improve a score) never inflate the global leaderboard. The
    ///      per-course best score can still improve on replay. Every attempt — first or repeat
    ///      — is logged to the FSI activity feed via Template G.
    /// @param courseId Stable ID assigned by the UI (e.g. 1 = "Crypto Basics & Safety").
    /// @param correctAnswers Number of questions answered correctly this run.
    /// @param totalQuestions Total questions in this run. Must be > 0 and within the cap.
    function completeCourse(uint256 courseId, uint256 correctAnswers, uint256 totalQuestions) external {
        require(totalQuestions > 0 && totalQuestions <= MAX_QUESTIONS_PER_COURSE, "bad totalQuestions");
        require(correctAnswers <= totalQuestions, "correctAnswers > totalQuestions");

        uint256 scoreBps = (correctAnswers * 10_000) / totalQuestions;
        uint256 xpAwarded = 0;

        if (!courseCompleted[courseId][msg.sender]) {
            courseCompleted[courseId][msg.sender] = true;
            xpAwarded = correctAnswers * xpPerCorrectAnswer;
            xp[msg.sender] += xpAwarded;
            _fsiSetAddr(NS_XP, msg.sender, xp[msg.sender]);
        }

        if (scoreBps > courseScore[courseId][msg.sender]) {
            courseScore[courseId][msg.sender] = scoreBps;
            _fsiSetRound(NS_COURSE, courseId, msg.sender, courseScore[courseId][msg.sender]);
        }

        _fsiLog(NS_ATTEMPT, courseId, msg.sender, address(0), scoreBps, xpAwarded);
        emit CourseAttempt(msg.sender, courseId, scoreBps, xpAwarded);
    }

    /// @notice Level derived from lifetime XP. Pure convenience — the UI can compute this itself.
    function levelOf(address user) external view returns (uint256) {
        return xp[user] / xpPerLevel;
    }

    // ---------------------------------------------------------------------
    // Owner-only tuning. No function here can move funds or alter past results —
    // only the forward-looking XP/level rates used by future completeCourse calls.
    // ---------------------------------------------------------------------

    function setXpPerCorrectAnswer(uint256 newValue) external onlyOwner {
        require(newValue > 0, "zero rate");
        emit XpPerCorrectAnswerUpdated(xpPerCorrectAnswer, newValue);
        xpPerCorrectAnswer = newValue;
    }

    function setXpPerLevel(uint256 newValue) external onlyOwner {
        require(newValue > 0, "zero rate");
        emit XpPerLevelUpdated(xpPerLevel, newValue);
        xpPerLevel = newValue;
    }

    function setOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
    }
}
