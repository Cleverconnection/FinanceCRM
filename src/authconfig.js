export const msalConfig = {
  auth: {
    clientId: "2d7bcc44-8337-42ec-a3e2-6ba7c9bda91f",
    authority: "https://login.microsoftonline.com/common",
    redirectUri:
      import.meta.env.MODE === "development"
        ? `${window.location.origin}/`
        : "https://cleverconnection.github.io/FinanceCRM/",
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: true,
  },
  system: {
    allowRedirectInIframe: true,
  },
};
