import mongoose from 'mongoose';
import { Activity, Team, User, Workout } from '../models/index.js';

function ensureObjectId(value: unknown, fieldName: string) {
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) {
    throw Object.assign(new Error(`${fieldName} must be a valid Mongo ObjectId`), { status: 400 });
  }
}

function normalizeFocus(typeOrGoal: string | undefined) {
  const normalized = (typeOrGoal ?? '').toLowerCase();
  if (['run', 'cycle', 'walk', 'endurance'].includes(normalized)) return 'endurance';
  if (['strength', 'lift', 'power'].includes(normalized)) return 'strength';
  if (['mobility', 'stretch', 'recovery'].includes(normalized)) return 'mobility';
  return normalized || 'endurance';
}

export async function listActivities() {
  return Activity.find().lean();
}

export async function createActivity(input: unknown) {
  if (!input || typeof input !== 'object') {
    throw Object.assign(new Error('Activity payload is required'), { status: 400 });
  }

  const { userId, teamId, type, minutes } = input as Record<string, unknown>;

  if (!userId || !teamId || typeof type !== 'string' || !type.trim()) {
    throw Object.assign(new Error('Activity requires userId, teamId, and type'), { status: 400 });
  }

  const minutesValue = Number(minutes);
  if (!Number.isFinite(minutesValue) || minutesValue <= 0) {
    throw Object.assign(new Error('Activity minutes must be a positive number'), { status: 400 });
  }

  ensureObjectId(userId, 'userId');
  ensureObjectId(teamId, 'teamId');

  const [user, team] = await Promise.all([
    User.findById(userId),
    Team.findById(teamId),
  ]);

  if (!user || !team) {
    throw Object.assign(new Error('Activity user and team must already exist'), { status: 400 });
  }

  const activity = await Activity.create({
    user: user._id,
    team: team._id,
    type: type.trim(),
    minutes: minutesValue,
    points: minutesValue,
    occurredAt: new Date(),
  });

  return activity;
}

export async function listTeams() {
  return Team.find().lean();
}

export async function createTeam(input: unknown) {
  if (!input || typeof input !== 'object') {
    throw Object.assign(new Error('Team payload is required'), { status: 400 });
  }

  const { name, mascot, members } = input as Record<string, unknown>;
  if (typeof name !== 'string' || !name.trim()) {
    throw Object.assign(new Error('Team name is required'), { status: 400 });
  }
  if (typeof mascot !== 'string' || !mascot.trim()) {
    throw Object.assign(new Error('Team mascot is required'), { status: 400 });
  }
  if (members !== undefined && !Array.isArray(members)) {
    throw Object.assign(new Error('Team members must be an array'), { status: 400 });
  }

  const memberIds = (members ?? []).map((member) => {
    if (typeof member !== 'string' && !(member instanceof mongoose.Types.ObjectId)) {
      throw Object.assign(new Error('Each team member must be a valid user id'), { status: 400 });
    }
    const memberId = String(member);
    ensureObjectId(memberId, 'team member');
    return new mongoose.Types.ObjectId(memberId);
  });

  const team = await Team.create({
    name: name.trim(),
    mascot: mascot.trim(),
    members: memberIds,
  });

  if (memberIds.length > 0) {
    await Promise.all(
      memberIds.map((memberId) => User.updateOne({ _id: memberId }, { $set: { team: team._id } })),
    );
  }

  return team;
}

export async function getLeaderboard() {
  const leaderboard = await Activity.aggregate([
    { $group: { _id: '$team', totalPoints: { $sum: '$points' } } },
    { $lookup: { from: 'teams', localField: '_id', foreignField: '_id', as: 'team' } },
    { $unwind: '$team' },
    { $project: { _id: 0, teamId: '$_id', teamName: '$team.name', totalPoints: 1 } },
    { $sort: { totalPoints: -1, teamName: 1 } },
  ]);

  return leaderboard.map((entry, index) => ({
    teamId: entry.teamId,
    teamName: entry.teamName,
    totalPoints: entry.totalPoints,
    rank: index + 1,
  }));
}

export async function suggestWorkouts(userEmail: string) {
  if (!userEmail || typeof userEmail !== 'string' || !userEmail.trim()) {
    throw Object.assign(new Error('User email is required'), { status: 400 });
  }

  const user = await User.findOne({ email: userEmail }).lean();
  if (!user) {
    throw Object.assign(new Error('User not found'), { status: 400 });
  }

  const recentActivity = await Activity.findOne({ user: user._id }).sort({ occurredAt: -1 }).lean();
  const focus = normalizeFocus((recentActivity?.type ?? user.fitnessGoal) as string | undefined);
  const workouts = await Workout.find({ focus }).lean();

  if (workouts.length === 0) {
    const fallback = await Workout.find().lean();
    return fallback.map((workout) => ({
      ...workout,
      reason: `Matches your ${focus} activity pattern and fitness goals.`,
    }));
  }

  return workouts.map((workout) => ({
    ...workout,
    reason: `Matches your ${recentActivity?.type ?? focus} activity pattern and ${focus} focus.`,
  }));
}

export { User };
