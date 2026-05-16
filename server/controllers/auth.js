import mongoose from "mongoose";
import users from "../Modals/Auth.js";
import otpModel from "../Modals/otp.js";
import { sendEmail } from "../utils/notification.js";

const getOtpMode = () => "email";

const generateOtp = () => `${Math.floor(100000 + Math.random() * 900000)}`;

export const startLogin = async (req, res) => {
  const { email, name, image, state, city, mobile, otpPreference } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }
  const cleanEmail = email.toLowerCase().trim();

  const detectedOtpMode = getOtpMode(cleanEmail, state);
  const otpMode = otpPreference || detectedOtpMode;
  
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  try {
    const existingUser = await users.findOne({ email: cleanEmail }).select("mobile");
    const effectiveMobile = (mobile || existingUser?.mobile || "").trim();

    await otpModel.deleteMany({ email: cleanEmail });
    await otpModel.create({
      email: cleanEmail,
      mobile: effectiveMobile,
      otp,
      state,
      city,
      expiresAt,
    });

    let deliveryFailed = false;
    try {
      if (otpMode === "email") {
        await sendEmail({
          to: cleanEmail,
          subject: "YourTube Login OTP",
          text: `Your OTP is ${otp}. It expires in 5 minutes.`,
          html: `<p>Your OTP is <b>${otp}</b>. It expires in 5 minutes.</p>`,
        });
      }
      // For mobile mode, OTP is handled by Firebase Phone Auth on frontend.
    } catch (deliveryError) {
      console.error(`OTP delivery failed for [${otpMode}] mode.`);
      deliveryFailed = true;
    }

    if (deliveryFailed) {
      return res.status(503).json({
        otpSent: false,
        otpMode,
        deliveryFailed: true,
        message: "OTP delivery failed. Please try again in a moment.",
      });
    }

    return res.status(200).json({
      otpSent: true,
      otpMode,
      deliveryFailed: false,
      message: otpMode === "email" ? "OTP sent to email" : "Proceed with Firebase mobile OTP verification in app",
      profilePreview: {
        email: cleanEmail,
        name,
        image,
        state,
        city,
      },
    });
  } catch (error) {
    console.error("start login error:", error);
    return res.status(500).json({ message: "Unable to start login" });
  }
};

export const verifyLoginOtp = async (req, res) => {
  const { email, otp, name, image, state, city, mobile } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ message: "Email and OTP are required" });
  }
  const cleanEmail = email.toLowerCase().trim();
  try {
    const otpDoc = await otpModel.findOne({ email: cleanEmail }).sort({ createdAt: -1 });
    if (!otpDoc) {
      return res.status(400).json({ message: "No active OTP session found. Request a new one." });
    }
    if (otpDoc.expiresAt < new Date()) {
      return res.status(400).json({ message: "OTP expired. Request a new one." });
    }
    
    if (otpDoc.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    const nextState = state || otpDoc.state || "";
    const nextCity = city || otpDoc.city || "";
    const otpMode = getOtpMode(cleanEmail, nextState);

    let existingUser = await users.findOne({ email: cleanEmail });
    if (!existingUser) {
      existingUser = await users.create({
        email: cleanEmail,
        mobile: mobile || otpDoc.mobile,
        name,
        image,
        state: nextState,
        city: nextCity,
        loginOtpMode: otpMode,
        watchLimitMinutes: 5, // Initialize with 100% compliance
        plan: "FREE",
      });
    } else {
      existingUser = await users.findByIdAndUpdate(
        existingUser._id,
        {
          $set: {
            name: name || existingUser.name,
            image: image || existingUser.image,
            mobile: mobile || otpDoc.mobile || existingUser.mobile,
            state: nextState || existingUser.state,
            city: nextCity || existingUser.city,
            loginOtpMode: otpMode,
          },
        },
        { new: true }
      );
    }

    await otpModel.deleteMany({ email: cleanEmail });

    return res.status(200).json({
      verified: true,
      result: existingUser,
    });
  } catch (error) {
    console.error("verify login error:", error);
    return res.status(500).json({ message: "Something went wrong" });
  }
};

export const mobileLogin = async (req, res) => {
  const { email, name, image, state, city, mobile } = req.body;
  if (!email || !mobile) {
    return res.status(400).json({ message: "Email and mobile are required" });
  }

  const cleanEmail = email.toLowerCase().trim();
  try {
    const otpMode = getOtpMode(cleanEmail, state || "");
    let existingUser = await users.findOne({ email: cleanEmail });

    if (!existingUser) {
      existingUser = await users.create({
        email: cleanEmail,
        mobile,
        name,
        image,
        state: state || "",
        city: city || "",
        loginOtpMode: otpMode,
        watchLimitMinutes: 5,
        plan: "FREE",
      });
    } else {
      existingUser = await users.findByIdAndUpdate(
        existingUser._id,
        {
          $set: {
            name: name || existingUser.name,
            image: image || existingUser.image,
            mobile: mobile || existingUser.mobile,
            state: state || existingUser.state,
            city: city || existingUser.city,
            loginOtpMode: otpMode,
          },
        },
        { new: true }
      );
    }

    return res.status(200).json({ verified: true, result: existingUser });
  } catch (error) {
    console.error("mobile login error:", error);
    return res.status(500).json({ message: "Unable to complete mobile login" });
  }
};

export const login = async (req, res) => {
  const { email, name, image } = req.body;

  const cleanEmail = email.toLowerCase().trim();
  try {
    const existingUser = await users.findOne({ email: cleanEmail });

    if (!existingUser) {
      const newUser = await users.create({ email: cleanEmail, name, image });
      return res.status(201).json({ result: newUser });
    }
    return res.status(200).json({ result: existingUser });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Something went wrong" });
  }
};

export const updateprofile = async (req, res) => {
  const { id: _id } = req.params;
  const { channelname, description, city, state, mobile } = req.body;
  if (!mongoose.Types.ObjectId.isValid(_id)) {
    return res.status(500).json({ message: "User unavailable..." });
  }
  try {
    const updatedata = await users.findByIdAndUpdate(
      _id,
      {
        $set: {
          channelname,
          description,
          city,
          state,
          mobile,
        },
      },
      { new: true }
    );
    return res.status(201).json(updatedata);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Something went wrong" });
  }
};

export const getUserById = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(404).json({ message: "Invalid user id" });
  }

  try {
    const user = await users.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    return res.status(200).json(user);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Something went wrong" });
  }
};

export const subscribeChannel = async (req, res) => {
  const { id: channelId } = req.params;
  const { userId } = req.body;

  const isSampleChannel = !mongoose.Types.ObjectId.isValid(channelId);
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }

  try {
    const subscriber = await users.findById(userId);

    if (!subscriber) {
      return res.status(404).json({ message: "User not found" });
    }

    if (isSampleChannel) {
      // Handle Sample Channel Subscription
      await users.findByIdAndUpdate(userId, { $addToSet: { subscribedChannels: channelId } });
      return res.status(200).json({
        message: "Subscribed to sample channel successfully",
        subscribed: true,
      });
    }

    const channel = await users.findById(channelId);
    if (!channel) {
      return res.status(404).json({ message: "Channel not found" });
    }

    if (channel.subscribers.includes(userId)) {
      return res.status(200).json({ message: "Already subscribed", subscribed: true });
    }

    const updatedChannel = await users.findByIdAndUpdate(
      channelId,
      { $addToSet: { subscribers: userId } },
      { new: true }
    );
    await users.findByIdAndUpdate(userId, { $addToSet: { subscribedChannels: channelId } });

    return res.status(200).json({
      message: "Subscribed successfully",
      subscribed: true,
      subscribersCount: updatedChannel?.subscribers?.length || 0,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Something went wrong" });
  }
};

export const unsubscribeChannel = async (req, res) => {
  const { id: channelId } = req.params;
  const { userId } = req.body;

  const isSampleChannel = !mongoose.Types.ObjectId.isValid(channelId);
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }

  try {
    if (isSampleChannel) {
      await users.findByIdAndUpdate(userId, { $pull: { subscribedChannels: channelId } });
      return res.status(200).json({
        message: "Unsubscribed from sample channel successfully",
        subscribed: false,
      });
    }

    const updatedChannel = await users.findByIdAndUpdate(
      channelId,
      { $pull: { subscribers: userId } },
      { new: true }
    );
    await users.findByIdAndUpdate(userId, { $pull: { subscribedChannels: channelId } });

    return res.status(200).json({
      message: "Unsubscribed successfully",
      subscribed: false,
      subscribersCount: updatedChannel?.subscribers?.length || 0,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Something went wrong" });
  }
};

export const updateWatchTime = async (req, res) => {
  const { id } = req.params;
  const { incrementSeconds } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(404).json({ message: "Invalid user id" });
  }

  try {
    const user = await users.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const today = new Date().toISOString().split("T")[0];
    let update = {};

    if (user.lastWatchDate !== today) {
      // It's a new day! Reset watch time
      update = {
        $set: {
          lastWatchDate: today,
          watchedSecondsToday: incrementSeconds || 0,
        },
      };
    } else {
      // Increment existing watch time
      update = {
        $inc: { watchedSecondsToday: incrementSeconds || 0 },
      };
    }

    const updatedUser = await users.findByIdAndUpdate(id, update, { new: true });
    
    const limitMinutes = updatedUser.watchLimitMinutes;
    // If limitMinutes is null, it's unlimited. Return a large number (100 years).
    const limitSeconds = limitMinutes === null ? 3153600000 : limitMinutes * 60;
    const remainingSeconds = Math.max(0, limitSeconds - updatedUser.watchedSecondsToday);

    return res.status(200).json({ 
      watchedSecondsToday: updatedUser.watchedSecondsToday,
      remainingSeconds
    });
  } catch (error) {
    console.error("Update Watch Time error:", error);
    return res.status(500).json({ message: "Something went wrong" });
  }
};

export const getSubscriptionStatus = async (req, res) => {
  const { channelId, userId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(200).json({ subscribed: false, isSubscribed: false, subscribersCount: 0 });
  }

  try {
    const user = await users.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const isSubscribed = user.subscribedChannels.some(id => id.toString() === channelId.toString());
    let subscribersCount = 0;
    if (mongoose.Types.ObjectId.isValid(channelId)) {
      const channel = await users.findById(channelId).select("subscribers");
      subscribersCount = channel?.subscribers?.length || 0;
    }
    return res.status(200).json({
      subscribed: isSubscribed,
      isSubscribed,
      subscribersCount,
    });
  } catch (error) {
    console.error("Get Subscription Status error:", error);
    return res.status(500).json({ message: "Something went wrong" });
  }
};

export const subscribeChannelBody = async (req, res) => {
  const { channelId, userId } = req.body;
  
  if (!channelId || !userId) {
    return res.status(400).json({ message: "Missing channel or user ID" });
  }

  // Wrap internal call
  req.params.id = channelId;
  return subscribeChannel(req, res);
};

export const updateWatchTimeBody = async (req, res) => {
  const { userId, incrementSeconds } = req.body;
  if (!userId) return res.status(400).json({ message: "Missing user ID" });

  // Wrap internal call
  req.params.id = userId;
  return updateWatchTime(req, res);
};
