import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../providers/AuthProvider.js";
import { AuthModal } from "./modals/AuthModal.js";
import { UserIcon, UserPlusIcon } from "./icons.js";

interface UserAvatarButtonProps {
  onNavigate: (path: string) => void;
}

export function UserAvatarButton({ onNavigate }: UserAvatarButtonProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);

  function handleClick() {
    if (user) {
      onNavigate("/account");
    } else {
      setAuthModalOpen(true);
    }
  }

  return (
    <>
      <button
        className={`user-avatar-btn${user ? " user-avatar-btn-active" : ""}`}
        onClick={handleClick}
        title={user ? user.email : t("auth.login")}
      >
        {user ? <UserIcon /> : <UserPlusIcon />}
      </button>
      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </>
  );
}
