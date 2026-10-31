"use client";

import { useState, useEffect, useCallback } from "react";
import {
  UserProfile,
  DEFAULT_USER_PROFILE,
  getUserProfile,
  saveUserProfile as persistUserProfile,
  USER_PROFILE_EVENT,
} from "@/lib/userProfile";

export function useUserProfile() {
  const [profile, setProfileState] = useState<UserProfile>(DEFAULT_USER_PROFILE);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setProfileState(getUserProfile());
    setIsLoaded(true);

    const handleProfileUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<UserProfile>;
      if (customEvent.detail) {
        setProfileState(customEvent.detail);
      } else {
        setProfileState(getUserProfile());
      }
    };

    window.addEventListener(USER_PROFILE_EVENT, handleProfileUpdate);
    return () => {
      window.removeEventListener(USER_PROFILE_EVENT, handleProfileUpdate);
    };
  }, []);

  const saveProfile = useCallback((newProfile: UserProfile) => {
    const cleaned = persistUserProfile(newProfile);
    if (cleaned) {
      setProfileState(cleaned);
    } else {
      setProfileState(getUserProfile());
    }
  }, []);

  return {
    profile,
    saveProfile,
    isLoaded,
  };
}
