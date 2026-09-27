import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import nunjucks from 'nunjucks';
import dotenv from 'dotenv';

import {
  adminAuth,
  db,
  firebaseClientConfig
} from './config/firebase.js';

import {
  putObject,
  getObject,
  createSignedUrl
} from './config/supabaseStorage.js';

import {
  optionalAuth,
  loginRequired,
  adminRequired
} from './middleware/auth.js';

import {
  errorHandler,
  notFound
} from './middleware/errorHandler.js';

import {
  SKILLS,
  TOPIC_META,
  COLD_START_QUESTIONS,
  PLAYLISTS,
  buildRoadmap,
  generalPlan,
  threshold
} from './services/curriculumService.js';

import {
  getUser,
  getUserByFirebaseUid,
  getUserByEmail,
  getUserByUsername,
  createFirebaseUser,
  updateUser,
  getPreferences,
  updatePreferences,

  // Help Desk
  createSupportTicket,
  getSupportTickets,
  getSupportTicketsForUser,
  getSupportTicket,
  markSupportTicketReviewed,
  approveSupportTicket,
  updateSupportTicketAdmin,
  deleteSupportTicket,
  updateStudentAccountStatus,
  ensureStudentAccountStatus,

  createNotification,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  clearAllNotifications,

  getEnrollment,
  getEnrollments,
  saveEnrollment,
  getMastered,
  getProgress,
  upsertProgress,
  clearBaseline,
  recordActivity,
  streakInfo,
  allUsers,
  ensureSkillDocuments
} from './services/firebaseService.js';

import {
  analyzeSyllabus,
  generateDiagnostic,
  evaluateDiagnostic,
  generateRoadmap,
  generateLearningExplanation
} from './services/aiService.js';

import {
  validateUpload,
  extractText,
  imageDataUrl,
  storeSyllabus,
  saveSyllabusMeta
} from './services/syllabusService.js';

import {
  recommend,
  calculateMasteryMap,
  masteryStatus
} from './services/recommendationService.js';

import {
  getVideos,
  getDocs,
  LANGUAGES,
  getTranscript,
  getPlaylistJump
} from './services/youtubeService.js';

import {
  answer as chatbotAnswer
} from './services/chatbotService.js';


/* =========================================================
   APP SETUP
========================================================= */

dotenv.config();

const __dirname =
  path.dirname(
    fileURLToPath(import.meta.url)
  );

const root =
  path.resolve(
    __dirname,
    '..'
  );

const app =
  express();

const PORT =
  Number(
    process.env.PORT || 5000
  );

const COOKIE =
  process.env.SESSION_COOKIE_NAME ||
  'learnora_session';


app.set(
  'trust proxy',
  1
);

app.use(
  helmet({
    contentSecurityPolicy:
      false,
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin'
    }
  })
);

app.use(
  rateLimit({
    windowMs: 60_000,
    max: 180,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.use(
  express.json({
    limit: '1mb'
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: '1mb'
  })
);

app.use(
  cookieParser()
);

app.use(
  express.static(
    path.join(
      root,
      'public'
    )
  )
);


/* =========================================================
   FILE UPLOAD
========================================================= */

const upload =
  multer({
    storage:
      multer.memoryStorage(),

    limits: {
      fileSize:
        4 * 1024 * 1024
    }
  });


/* =========================================================
   NUNJUCKS
========================================================= */

const njEnv =
  nunjucks.configure(
    path.join(
      root,
      'views'
    ),
    {
      autoescape: true,
      express: app,
      noCache:
        process.env.NODE_ENV !==
        'production'
    }
  );

njEnv.addFilter(
  'tojson',
  value =>
    JSON.stringify(
      value ?? null
    )
);

njEnv.addFilter(
  'round',
  (
    value,
    digits = 0
  ) => {
    const n =
      Number(value || 0);

    const m =
      10 **
      Number(digits || 0);

    return (
      Math.round(
        n * m
      ) / m
    );
  }
);

njEnv.addFilter(
  'int',
  value =>
    parseInt(
      Number(value || 0),
      10
    )
);

njEnv.addFilter(
  'dt',
  value =>
    value
      ? new Date(
          value
        ).toLocaleString(
          'en-IN',
          {
            dateStyle:
              'medium',
            timeStyle:
              'short'
          }
        )
      : '—'
);


/* =========================================================
   URL HELPERS
========================================================= */

const routeMap = {
  intro: '/',
  login: '/login',
  register: '/register',
  forgot_password:
    '/forgot-password',
  dashboard:
    '/dashboard',
  my_skills:
    '/my-skills',
  roadmaps:
    '/roadmaps',
  assessments:
    '/assessments',
  start_skill:
    '/skill/:skill_id/start',
  syllabus_preview:
    '/skill/:skill_id/syllabus-preview',
  quiz:
    '/skill/:skill_id/quiz',
  roadmap:
    '/skill/:skill_id/roadmap',
  topic_page:
    '/skill/:skill_id/topic/:topic_id',
  profile:
    '/profile',
  settings:
    '/settings',
  notifications:
    '/notifications',
  helpdesk:
    '/help',
  logout:
    '/logout',
  firebase_session:
    '/auth/firebase-session',
  admin_login:
    '/admin-login',
  admin_dashboard:
    '/admin',
  admin_helpdesk:
    '/admin/helpdesk',
  admin_student_detail:
    '/admin/student/:user_id',
  ppt_upload:
    '/ppt-upload',
  ppt_set_current:
    '/ppt-upload/set-current/:id',
  ppt_view:
    '/ppt-upload/view/:id',
  ppt_download:
    '/ppt-upload/download/:id',
  static:
    '/'
};


function urlFor(
  endpoint,
  args = {}
) {
  let u =
    routeMap[endpoint] ||
    endpoint;

  if (
    endpoint ===
    'static'
  ) {
    return (
      '/' +
      String(
        args.filename ||
          ''
      ).replace(
        /^\//,
        ''
      )
    );
  }

  for (
    const [k, v]
    of Object.entries(args)
  ) {
    u =
      u.replace(
        ':' + k,
        encodeURIComponent(
          String(v)
        )
      );
  }

  const used =
    new Set(
      (
        u.match(
          /:([A-Za-z_]+)/g
        ) || []
      ).map(
        x =>
          x.slice(1)
      )
    );

  const qs =
    Object.entries(
      args
    ).filter(
      ([k]) =>
        !routeMap[
          endpoint
        ]?.includes(
          ':' + k
        ) &&
        !used.has(k)
    );

  if (qs.length) {
    u +=
      '?' +
      new URLSearchParams(
        qs
      ).toString();
  }

  return u;
}


function round(
  v,
  d = 0
) {
  const n =
    Number(v || 0);

  const m =
    10 ** d;

  return (
    Math.round(
      n * m
    ) / m
  );
}


/* =========================================================
   FLASH MESSAGES
========================================================= */

app.use(
  (req, res, next) => {
    const flashes = [];

    try {
      const raw =
        req.cookies
          ?.learnora_flash;

      if (raw) {
        const parsed =
          JSON.parse(raw);

        flashes.push(
          ...(Array.isArray(
            parsed
          )
            ? parsed
            : [])
        );

        res.clearCookie(
          'learnora_flash'
        );
      }
    } catch {}

    req.flash = (
      category,
      message
    ) => {
      const existing = [];

      try {
        const raw =
          req.cookies
            ?.learnora_flash;

        if (raw) {
          existing.push(
            ...JSON.parse(
              raw
            )
          );
        }
      } catch {}

      existing.push({
        category,
        message
      });

      res.cookie(
        'learnora_flash',
        JSON.stringify(
          existing
        ),
        {
          httpOnly: true,
          sameSite:
            'lax',
          secure:
            process.env.NODE_ENV ===
            'production'
        }
      );
    };

    res.locals.flashes =
      flashes;

    res.locals.right_html =
      '';

    res.locals.url_for =
      urlFor;

    res.locals.firebase_config =
      firebaseClientConfig;

    res.locals.request = {
      endpoint:
        routeEndpoint(
          req.path
        ),
      path:
        req.path
    };

    res.locals.get_flashed_messages =
      () =>
        flashes;

    next();
  }
);


function routeEndpoint(p) {
  if (p === '/') return 'intro';
  if (p === '/login') return 'login';
  if (p === '/register') return 'register';
  if (p === '/forgot-password')
    return 'forgot_password';
  if (p === '/dashboard')
    return 'dashboard';
  if (p === '/my-skills')
    return 'my_skills';
  if (p === '/roadmaps')
    return 'roadmaps';
  if (p === '/assessments')
    return 'assessments';
  if (p === '/profile')
    return 'profile';
  if (p === '/settings')
    return 'settings';
  if (p === '/notifications')
    return 'notifications';
  if (p === '/help')
    return 'helpdesk';
  if (p === '/admin/helpdesk' || p.startsWith('/admin/helpdesk/'))
    return 'admin_helpdesk';
  if (p === '/ppt-upload' || p.startsWith('/ppt-upload/'))
    return 'ppt_upload';
  if (
    p.startsWith(
      '/admin/research'
    )
  )
    return 'ppt_upload';
  if (
    p.startsWith(
      '/admin/student'
    )
  )
    return 'admin_student_detail';
  if (p === '/admin')
    return 'admin_dashboard';
  if (p.includes('/quiz'))
    return 'quiz';
  if (
    p.includes(
      '/syllabus-preview'
    )
  )
    return 'syllabus_preview';
  if (
    p.includes('/topic/')
  )
    return 'topic_page';
  if (
    p.includes('/roadmap')
  )
    return 'roadmap';
  if (
    p.includes('/start')
  )
    return 'start_skill';

  return '';
}


/* =========================================================
   AUTH MIDDLEWARE
========================================================= */

app.use(
  optionalAuth
);

app.use(
  (req, res, next) => {
    res.locals.user =
      req.user;

    res.locals.is_admin =
      req.user?.role ===
        'admin' ||
      req.user?.is_admin ===
        true;

    res.locals.session = {
      user_id:
        req.firebaseUser
          ?.uid ||
        req.user
          ?.firebase_uid ||
        null,

      is_admin:
        req.user?.role ===
          'admin' ||
        req.user?.is_admin ===
          true
    };

    next();
  }
);


/* =========================================================
   PUBLIC PAGES
========================================================= */

app.get(
  '/',
  async (
    req,
    res
  ) =>
    res.render(
      'landing.html',
      {
        skills: SKILLS,

        preview_skills:
          Object.entries(
            SKILLS
          ).slice(0, 3),

        year:
          new Date()
            .getFullYear()
      }
    )
);

app.get(
  '/login',
  (req, res) =>
    res.render(
      'login.html'
    )
);

app.get(
  '/register',
  (req, res) =>
    res.render(
      'register.html'
    )
);

app.get(
  '/forgot-password',
  (req, res) =>
    res.render(
      'forgot_password.html'
    )
);


/* =========================================================
   FIREBASE USER SESSION
========================================================= */

app.post(
  '/auth/firebase-session',
  async (
    req,
    res
  ) => {
    try {
      const {
        idToken,
        profile = {}
      } = req.body || {};

      if (!idToken) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              'Missing Firebase ID token.'
          });
      }

      const decoded =
        await adminAuth
          .verifyIdToken(
            idToken
          );

      if (!decoded.uid) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              'Firebase token has no UID.'
          });
      }

      if (!decoded.email) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              'Firebase account must have an email address.'
          });
      }

      if (
        decoded.email_verified !==
        true
      ) {
        return res
          .status(403)
          .json({
            ok: false,
            error:
              'Please verify your email address before accessing Learnora.'
          });
      }

      const email =
        String(
          decoded.email
        )
          .trim()
          .toLowerCase();

      let user =
        await getUserByFirebaseUid(
          decoded.uid
        );

      if (!user) {
        user =
          await getUserByEmail(
            email
          );
      }

      if (!user) {
        const name =
          String(
            profile.name ||
              decoded.name ||
              email.split(
                '@'
              )[0]
          )
            .trim() ||
          'Learner';

        let username =
          (
            String(
              profile.username ||
                email.split(
                  '@'
                )[0]
            )
              .toLowerCase()
              .replace(
                /[^a-z0-9_]/g,
                ''
              )
              .slice(
                0,
                20
              ) ||
            'learner'
          );

        const baseUsername =
          username;

        let suffix = 1;

        while (
          await getUserByUsername(
            username
          )
        ) {
          username = (
            baseUsername.slice(
              0,
              16
            ) +
            suffix
          ).slice(
            0,
            20
          );

          suffix++;
        }

        const userId =
          await createFirebaseUser(
            {
              name,
              username,
              email,

              age:
                profile.age ||
                null,

              profession:
                String(
                  profile.profession ||
                    ''
                ),

              phone:
                String(
                  profile.phone ||
                    ''
                ),

              location:
                String(
                  profile.location ||
                    'India'
                ),

              firebase_uid:
                decoded.uid,

              role:
                'learner',

              is_admin:
                false
            }
          );

        user =
          await getUser(
            userId
          );
      }

      if (user) {
        user = await ensureStudentAccountStatus(user.id);
      }

      if (user && user.role !== 'admin' && user.is_admin !== true) {
        const accountStatus = String(user.account_status || 'active').toLowerCase();
        if (accountStatus !== 'active') {
          const labels = {
            suspended: 'Your Learnora account is suspended. Please contact an administrator.',
            restricted: 'Your Learnora account is restricted. Please contact an administrator.',
            terminated: 'Your Learnora account has been terminated. Please contact an administrator.'
          };
          return res.status(403).json({ ok: false, error: labels[accountStatus] || 'Your Learnora account is not active.' });
        }
      }

      if (!user) {
        return res
          .status(500)
          .json({
            ok: false,
            error:
              'Your Firebase account is valid, but the Learnora user profile could not be loaded.'
          });
      }

      if (
        user.firebase_uid !==
        decoded.uid
      ) {
        await updateUser(
          user.id,
          {
            firebase_uid:
              decoded.uid
          }
        );

        user =
          await getUser(
            user.id
          );
      }

      const requestedDays =
        Math.max(
          1,
          Math.min(
            5,
            Number(
              process.env
                .SESSION_DAYS ||
                5
            )
          )
        );

      const sessionCookie =
        await adminAuth
          .createSessionCookie(
            idToken,
            {
              expiresIn:
                requestedDays *
                24 *
                60 *
                60 *
                1000
            }
          );

      const isProduction =
        process.env.NODE_ENV ===
        'production';

      res.cookie(
        COOKIE,
        sessionCookie,
        {
          httpOnly: true,
          secure:
            isProduction,
          sameSite:
            'lax',
          path: '/',
          maxAge:
            requestedDays *
            86400000
        }
      );

      await recordActivity(
        user.id
      );

      console.log(
        `[auth] Session created for ${email} -> user ${user.id}`
      );

      return res
        .status(200)
        .json({
          ok: true,
          redirect:
            '/dashboard'
        });

    } catch (e) {
      console.error(
        '[auth] Firebase session exchange failed:',
        e
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            'Login failed on the server.',
          details:
            e.message
        });
    }
  }
);


/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post(
  '/admin-login',
  async (
    req,
    res
  ) => {
    try {
      const decoded =
        await adminAuth
          .verifyIdToken(
            req.body
              ?.idToken ||
              '',
            true
          );

      const user =
        await getUserByFirebaseUid(
          decoded.uid
        );

      if (
        !user ||
        (
          user.role !==
            'admin' &&
          user.is_admin !==
            true &&
          decoded.admin !==
            true
        )
      ) {
        return res
          .status(403)
          .json({
            ok: false,
            error:
              'This Firebase account is not authorized as an admin.'
          });
      }

      const sessionCookie =
        await adminAuth
          .createSessionCookie(
            req.body.idToken,
            {
              expiresIn:
                Math.min(
                  5 *
                    24 *
                    60 *
                    60 *
                    1000,

                  Number(
                    process.env
                      .SESSION_DAYS ||
                      5
                  ) *
                    86400000
                )
            }
          );

      res.cookie(
        COOKIE,
        sessionCookie,
        {
          httpOnly: true,
          secure:
            process.env.NODE_ENV ===
            'production',
          sameSite:
            'lax',
          maxAge:
            Number(
              process.env
                .SESSION_DAYS ||
                5
            ) *
            86400000
        }
      );

      return res.json({
        ok: true,
        redirect:
          '/admin'
      });

    } catch (e) {
      console.error(
        '[admin-login]',
        e
      );

      return res
        .status(401)
        .json({
          ok: false,
          error:
            'Invalid Firebase admin authentication.'
        });
    }
  }
);


/* =========================================================
   AUTH STATUS
========================================================= */

app.get(
  '/auth/status',
  (
    req,
    res
  ) => {
    res.json({
      ok:
        Boolean(
          req.firebaseUser &&
          req.user
        ),

      firebaseUser:
        req.firebaseUser
          ? {
              uid:
                req.firebaseUser
                  .uid,

              email:
                req.firebaseUser
                  .email ||
                null
            }
          : null,

      user:
        req.user
          ? {
              id:
                req.user.id,

              email:
                req.user.email ||
                null,

              firebase_uid:
                req.user
                  .firebase_uid ||
                null,

              role:
                req.user.role ||
                'learner'
            }
          : null,

      cookiePresent:
        Boolean(
          req.cookies
            ?.[COOKIE]
        )
    });
  }
);


/* =========================================================
   LOGOUT
========================================================= */

app.get(
  '/logout',
  (
    req,
    res
  ) => {
    res.clearCookie(
      COOKIE,
      {
        path: '/'
      }
    );

    req.flash(
      'info',
      'Logged out.'
    );

    res.redirect('/');
  }
);


/* =========================================================
   DASHBOARD
========================================================= */

app.get(
  '/dashboard',
  loginRequired,
  async (
    req,
    res,
    next
  ) => {
    try {
      const uid =
        req.user.id;

      const enrollments =
        await getEnrollments(
          uid
        );

      const skill_progress =
        [];

      const next_up =
        [];

      let total_mastered =
        0;

      let total_topics =
        0;

      for (
        const e
        of enrollments
      ) {
        if (
          !SKILLS[
            e.skill_id
          ]
        ) {
          continue;
        }

        const mastered =
          await getMastered(
            uid,
            e.skill_id
          );

        const total =
          SKILLS[
            e.skill_id
          ].topics.length;

        const pct =
          total
            ? Math.round(
                100 *
                  mastered.size /
                  total
              )
            : 0;

        total_mastered +=
          mastered.size;

        total_topics +=
          total;

        skill_progress.push({
          skill_id:
            e.skill_id,

          display_name:
            SKILLS[
              e.skill_id
            ].display_name,

          percent:
            pct,

          mastered_count:
            mastered.size,

          total_topics:
            total
        });

        const ready =
          buildRoadmap(
            e.skill_id,
            mastered
          ).find(
            x =>
              x.status ===
              'ready'
          );

        if (
          ready &&
          next_up.length < 4
        ) {
          next_up.push({
            skill_id:
              e.skill_id,

            skill_name:
              SKILLS[
                e.skill_id
              ].display_name,

            display:
              ready.display
          });
        }
      }

      const streak =
        await streakInfo(
          uid
        );

      const active =
        new Set(
          streak.active_dates
        );

      const week_activity =
        [];

      for (
        let i = 6;
        i >= 0;
        i--
      ) {
        const d =
          new Date();

        d.setDate(
          d.getDate() -
            i
        );

        const iso =
          d.toISOString()
            .slice(
              0,
              10
            );

        week_activity.push({
          label:
            d.toLocaleDateString(
              'en-US',
              {
                weekday:
                  'short'
              }
            ).slice(
              0,
              1
            ),

          date:
            iso,

          active:
            active.has(
              iso
            )
        });
      }

      console.log(
        `[dashboard] Rendering for user ${req.user.id} (${req.user.email || 'no-email'})`
      );

      return res.render(
        'dashboard.html',
        {
          user:
            req.user,

          skill_progress,

          all_skills:
            Object.entries(
              SKILLS
            ),

          streak,

          recent_activity:
            streak
              .active_dates
              .slice(
                -28
              ),

          week_activity,

          overall_percent:
            total_topics
              ? Math.round(
                  100 *
                    total_mastered /
                    total_topics
                )
              : 0,

          total_mastered,

          total_topics,

          next_up
        }
      );

    } catch (
      error
    ) {
      console.error(
        '[dashboard] Failed to render dashboard:',
        error
      );

      next(error);
    }
  }
);


/* =========================================================
   MY SKILLS
========================================================= */

app.get(
  '/my-skills',
  loginRequired,
  async (
    req,
    res
  ) => {
    const rows = [];

    for (
      const e
      of await getEnrollments(
        req.user.id
      )
    ) {
      const m =
        SKILLS[
          e.skill_id
        ];

      if (!m) {
        continue;
      }

      const mastered =
        await getMastered(
          req.user.id,
          e.skill_id
        );

      rows.push({
        skill_id:
          e.skill_id,

        display_name:
          m.display_name,

        description:
          m.description,

        mastered:
          mastered.size,

        total:
          m.topics.length,

        percent:
          m.topics.length
            ? Math.round(
                100 *
                  mastered.size /
                  m.topics.length
              )
            : 0
      });
    }

    res.render(
      'my_skills.html',
      {
        user:
          req.user,

        skills:
          rows
      }
    );
  }
);


/* =========================================================
   ROADMAPS
========================================================= */

app.get(
  '/roadmaps',
  loginRequired,
  async (
    req,
    res
  ) => {
    const enrolled = [];

    for (
      const e
      of await getEnrollments(
        req.user.id
      )
    ) {
      const m =
        SKILLS[
          e.skill_id
        ];

      if (!m) {
        continue;
      }

      const mastered =
        await getMastered(
          req.user.id,
          e.skill_id
        );

      const level =
        e.level ||
        'basic';

      const road =
        buildRoadmap(
          e.skill_id,
          mastered
        ).filter(
          x =>
            x.difficulty >=
            threshold(
              level
            )
        );

      const total_hours =
        road.reduce(
          (
            a,
            x
          ) =>
            a +
            Number(
              x.hours ||
                0
            ),
          0
        );

      const completed_hours =
        road
          .filter(
            x =>
              x.status ===
              'mastered'
          )
          .reduce(
            (
              a,
              x
            ) =>
              a +
              Number(
                x.hours ||
                  0
              ),
            0
          );

      const hours_week =
        Math.max(
          1,
          Number(
            e.hours_per_week ||
              5
          )
        );

      const ready =
        road.find(
          x =>
            x.status ===
            'ready'
        );

      enrolled.push({
        skill_id:
          e.skill_id,

        display_name:
          m.display_name,

        description:
          m.description,

        percent:
          m.topics.length
            ? Math.round(
                100 *
                  mastered.size /
                  m.topics.length
              )
            : 0,

        mastered:
          mastered.size,

        total:
          m.topics.length,

        hours_week,

        total_hours,

        remaining_hours:
          Math.max(
            0,
            total_hours -
              completed_hours
          ),

        remaining_weeks:
          Math.max(
            0,
            total_hours -
              completed_hours
          ) /
          hours_week,

        next_topic:
          ready?.display ||
          null
      });
    }

    res.render(
      'roadmaps.html',
      {
        user:
          req.user,

        enrolled
      }
    );
  }
);


/* =========================================================
   ASSESSMENTS
========================================================= */

app.get(
  '/assessments',
  loginRequired,
  async (req, res) => {
    const enrolled_ids = (
      await getEnrollments(req.user.id)
    ).map(
      e => e.skill_id
    );

    res.render(
      'assessments.html',
      {
        user: req.user,

        all_skills: Object.entries(SKILLS),

        enrolled_ids,

        TOPIC_META
      }
    );
  }
);


/* =========================================================
   SEARCH SKILLS
========================================================= */

app.get(
  '/api/search-skills',
  loginRequired,
  (
    req,
    res
  ) => {
    const q =
      String(
        req.query.q ||
          ''
      )
        .trim()
        .toLowerCase();

    const rows = [];

    for (
      const [
        sid,
        m
      ] of Object.entries(
        SKILLS
      )
    ) {
      let score = 0;

      const name =
        m.display_name
          .toLowerCase();

      if (!q) {
        score = 1;
      } else if (
        q === sid ||
        name.includes(q) ||
        name.startsWith(q)
      ) {
        score = 3;
      } else if (
        (m.aliases || [])
          .some(
            a =>
              String(a)
                .toLowerCase()
                .includes(q)
          )
      ) {
        score = 3;
      } else if (
        name
          .split(/\s+/)
          .some(
            w =>
              w.startsWith(q)
          )
      ) {
        score = 2;
      } else if (
        m.topics.some(
          t =>
            TOPIC_META[
              t
            ].display
              .toLowerCase()
              .split(/\s+/)
              .some(
                w =>
                  w === q ||
                  w.startsWith(q)
              )
        )
      ) {
        score = 1;
      }

      if (score) {
        rows.push({
          id:
            sid,

          name:
            m.display_name,

          description:
            m.description,

          _score:
            score
        });
      }
    }

    rows.sort(
      (
        a,
        b
      ) =>
        b._score -
        a._score
    );

    res.json(
      rows.map(
        ({
          _score,
          ...x
        }) =>
          x
      )
    );
  }
);


/* =========================================================
   START SKILL
========================================================= */

app.get(
  '/skill/:skillId/start',
  loginRequired,
  async (
    req,
    res
  ) => {
    const skillId =
      req.params.skillId;

    if (!SKILLS[skillId]) {
      return res.redirect(
        '/dashboard'
      );
    }

    res.render(
      'start_skill.html',
      {
        skill_id:
          skillId,

        skill:
          SKILLS[
            skillId
          ],

        user:
          req.user
      }
    );
  }
);


/* =========================================================
   START SKILL POST
========================================================= */

app.post(
  '/skill/:skillId/start',
  loginRequired,
  upload.single(
    'syllabus_file'
  ),
  async (
    req,
    res
  ) => {
    const skillId =
      req.params.skillId;

    if (!SKILLS[skillId]) {
      return res.redirect(
        '/dashboard'
      );
    }

    try {
      const hours =
        Math.max(
          1,
          Math.min(
            30,
            Number(
              req.body
                .hours_per_week ||
                5
            )
          )
        );

      const mode =
        req.body
          .syllabus_mode ||
        'general';

      let plan;

      let source =
        'general';

      let name =
        'General Learnora syllabus';

      let extractedText =
        '';

      let storagePath =
        '';

      let ext =
        '';

      if (
        mode ===
        'general'
      ) {
        plan =
          generalPlan(
            skillId
          );

      } else if (
        mode ===
        'text'
      ) {
        extractedText =
          String(
            req.body
              .syllabus_text ||
              ''
          ).trim();

        if (
          extractedText.length <
          30
        ) {
          throw new Error(
            'Please paste at least a short syllabus before continuing.'
          );
        }

        source =
          'text';

        name =
          'Pasted syllabus';

        plan =
          await analyzeSyllabus(
            {
              skillId,
              text:
                extractedText
            }
          );

      } else {
        ext =
          validateUpload(
            req.file
          );

        source =
          'upload';

        name =
          req.file
            .originalname;

        extractedText =
          await extractText(
            req.file,
            ext
          );

        if (
          !extractedText &&
          ![
            '.jpg',
            '.jpeg',
            '.png'
          ].includes(ext)
        ) {
          throw new Error(
            'No readable text was found in the uploaded document. For scanned PDFs, use JPG/PNG or paste the syllabus text.'
          );
        }

        plan =
          await analyzeSyllabus(
            {
              skillId,

              text:
                extractedText,

              imageDataUrl:
                [
                  '.jpg',
                  '.jpeg',
                  '.png'
                ].includes(
                  ext
                )
                  ? imageDataUrl(
                      req.file,
                      ext
                    )
                  : ''
            }
          );
      }

      if (plan.status === 'INVALID') {
        throw Object.assign(
          new Error(
            plan.reason ||
              plan.message ||
              `The uploaded syllabus does not appear to belong to ${SKILLS[skillId].display_name}.`
          ),
          { code: 'SYLLABUS_MISMATCH', validation: plan }
        );
      }

      if (source === 'upload') {
        storagePath =
          await storeSyllabus(
            req.user.firebase_uid,
            req.file,
            ext
          );
      }

      const selected =
        plan.selected_topic_ids.filter(
          t =>
            SKILLS[
              skillId
            ].topics.includes(t)
        );

      if (
        !selected.length
      ) {
        throw new Error(
          'No Learnora topics could be mapped from the syllabus.'
        );
      }

      plan.selected_topic_ids =
        selected;

      plan.roadmap =
        (
          plan.roadmap ||
          []
        ).filter(
          x =>
            selected.includes(
              x.topic_id
            )
        );

      const existingEnrollment =
        await getEnrollment(
          req.user.id,
          skillId
        );

      await saveEnrollment(
        req.user.id,
        skillId,
        {
          hours_per_week:
            hours,

          syllabus_source:
            source,

          syllabus_name:
            name,

          syllabus_summary:
            plan.summary ||
            SKILLS[
              skillId
            ].description,

          roadmap_json:
            JSON.stringify(
              plan
            ),

          diagnostic_json:
            '[]',

          level:
            'basic',

          level_score:
            0,

          level_reason:
            '',

          syllabus_id:
            null
        },
        !existingEnrollment
      );

      if (!existingEnrollment) {
        await createNotification({
          userId: req.user.id,
          audience: 'user',
          type: 'enrollment',
          title: `You're enrolled in ${SKILLS[skillId].display_name}`,
          message: 'Your learning path has been created. Continue to your syllabus and assessment.',
          link: `/skill/${skillId}/syllabus-preview`,
          icon: 'book-open'
        });

        await createNotification({
          audience: 'admin',
          type: 'enrollment',
          title: `${req.user.name || 'A student'} enrolled in ${SKILLS[skillId].display_name}`,
          message: `${req.user.email || 'Student account'} started a new course.`,
          link: '/admin',
          icon: 'book-open'
        });
      }

      if (
        source !==
          'general' ||
        storagePath
      ) {
        const sid =
          await saveSyllabusMeta(
            {
              userId:
                req.user
                  .firebase_uid,

              learnoraUserId:
                req.user.id,

              skillId,

              filename:
                name,

              storagePath,

              sourceType:
                source,

              extractedText,

              analysis:
                plan,

              curriculumMappings:
                selected
            }
          );

        await saveEnrollment(
          req.user.id,
          skillId,
          {
            syllabus_id:
              sid
          }
        );
      }

      await recordActivity(
        req.user.id
      );

      res.redirect(
        `/skill/${skillId}/syllabus-preview`
      );

    } catch (e) {
      console.error(
        '[syllabus]',
        e
      );

      const validation = e?.validation;
      const message = validation
        ? `${validation.reason || validation.message || 'The uploaded syllabus does not match the selected course.'} Selected course: ${SKILLS[skillId].display_name}. Detected subject: ${validation.detected_subject || 'Unknown'}.`
        : e.message;

      req.flash(
        'danger',
        message
      );

      res.redirect(
        `/skill/${skillId}/start`
      );
    }
  }
);


/* =========================================================
   SYLLABUS PREVIEW
========================================================= */

app.get(
  '/skill/:skillId/syllabus-preview',
  loginRequired,
  async (
    req,
    res
  ) => {
    const skillId =
      req.params.skillId;

    if (!SKILLS[skillId]) {
      return res.redirect(
        '/dashboard'
      );
    }

    const enrollment =
      await getEnrollment(
        req.user.id,
        skillId
      );

    if (!enrollment) {
      return res.redirect(
        `/skill/${skillId}/start`
      );
    }

    let plan;

    try {
      plan =
        JSON.parse(
          enrollment
            .roadmap_json ||
            '{}'
        );
    } catch {
      plan =
        generalPlan(
          skillId
        );
    }

    const selected =
      new Set(
        plan.selected_topic_ids ||
          SKILLS[
            skillId
          ].topics
      );

    const ids = [
      ...(
        plan.roadmap ||
        []
      )
        .map(
          x =>
            x.topic_id
        )
        .filter(
          x =>
            selected.has(x)
        ),

      ...SKILLS[
        skillId
      ].topics.filter(
        x =>
          selected.has(x) &&
          !(
            plan.roadmap ||
            []
          ).some(
            r =>
              r.topic_id ===
              x
          )
      )
    ];

    const roadmap =
      ids.map(
        (
          id,
          i
        ) => ({
          topic_id:
            id,

          display:
            TOPIC_META[
              id
            ].display,

          difficulty:
            TOPIC_META[
              id
            ].difficulty,

          hours:
            TOPIC_META[
              id
            ].hours,

          keywords:
            TOPIC_META[
              id
            ].keywords,

          priority:
            i + 1
        })
      );

    res.render(
      'syllabus_preview.html',
      {
        user:
          req.user,

        skill:
          SKILLS[
            skillId
          ],

        skill_id:
          skillId,

        enrollment,

        plan,

        roadmap
      }
    );
  }
);


/* =========================================================
   QUIZ
========================================================= */

app.get(
  '/skill/:skillId/quiz',
  loginRequired,
  async (
    req,
    res
  ) => {
    const skillId =
      req.params.skillId;

    const enrollment =
      await getEnrollment(
        req.user.id,
        skillId
      );

    if (!enrollment) {
      return res.redirect(
        `/skill/${skillId}/start`
      );
    }

    let plan = {};

    try {
      plan =
        JSON.parse(
          enrollment
            .roadmap_json ||
            '{}'
        );
    } catch {}

    let questions = [];

    try {
      questions =
        JSON.parse(
          enrollment
            .diagnostic_json ||
            '[]'
        );
    } catch {}

    if (
      !questions.length
    ) {
      questions =
        await generateDiagnostic(
          {
            skillId,

            topicIds:
              (
                plan.selected_topic_ids ||
                SKILLS[
                  skillId
                ].topics
              ),

            summary:
              enrollment
                .syllabus_summary ||
              ''
          }
        );

      await saveEnrollment(
        req.user.id,
        skillId,
        {
          diagnostic_json:
            JSON.stringify(
              questions
            )
        }
      );
    }

    res.render(
      'quiz.html',
      {
        user:
          req.user,

        skill_id:
          skillId,

        skill:
          SKILLS[
            skillId
          ],

        questions,

        hours_per_week:
          enrollment
            .hours_per_week,

        enrollment
      }
    );
  }
);


/* =========================================================
   QUIZ POST
========================================================= */

app.post(
  '/skill/:skillId/quiz',
  loginRequired,
  async (
    req,
    res
  ) => {
    const skillId =
      req.params.skillId;

    const enrollment =
      await getEnrollment(
        req.user.id,
        skillId
      );

    if (!enrollment) {
      return res.redirect(
        `/skill/${skillId}/start`
      );
    }

    const questions =
      JSON.parse(
        enrollment
          .diagnostic_json ||
        '[]'
      );

    if (
      questions.length !==
      7
    ) {
      req.flash(
        'warning',
        'The assessment expired. Please start it again.'
      );

      return res.redirect(
        `/skill/${skillId}/syllabus-preview`
      );
    }

    const answers = {};

    for (
      const q
      of questions
    ) {
      answers[
        q.id
      ] =
        Number(
          req.body[
            `q_${q.id}`
          ] ??
          -1
        );
    }

    const result =
      evaluateDiagnostic(
        questions,
        answers
      );

    const assessmentRef =
      db
        .collection(
          'assessments'
        )
        .doc();

    await assessmentRef.set({
      userId:
        req.user
          .firebase_uid,

      learnoraUserId:
        req.user.id,

      skillId,

      questions,

      answers,

      score:
        result.score,

      detectedLevel:
        result.level,

      reason:
        result.reason,

      createdAt:
        new Date()
          .toISOString()
    });

    await saveEnrollment(
      req.user.id,
      skillId,
      {
        level:
          result.level,

        level_score:
          result.score,

        level_reason:
          result.reason,

        assessment_id:
          assessmentRef.id
      }
    );

    await clearBaseline(
      req.user.id,
      skillId
    );

    const selected =
      (
        JSON.parse(
          enrollment
            .roadmap_json ||
          '{}'
        ).selected_topic_ids ||
        SKILLS[
          skillId
        ].topics
      );

    for (
      const id
      of selected
    ) {
      if (
        TOPIC_META[
          id
        ].difficulty <
        threshold(
          result.level
        )
      ) {
        await upsertProgress(
          req.user.id,
          skillId,
          id,
          true,
          1,
          'level_baseline'
        );
      }
    }

    for (
      const q
      of questions
    ) {
      await upsertProgress(
        req.user.id,
        skillId,
        q.topic_id,
        answers[q.id] ===
          q.answer,

        answers[q.id] ===
          q.answer
          ? 1
          : 0,

        'diagnostic'
      );
    }

    const roadmap =
      await generateRoadmap(
        {
          skillId,

          selectedTopicIds:
            selected,

          learnerLevel:
            result.level,

          diagnosticRows:
            result.rows,

          summary:
            enrollment
              .syllabus_summary ||
            ''
        }
      );

    await db
      .collection(
        'roadmaps'
      )
      .doc(
        `${req.user.id}__${skillId}`
      )
      .set(
        {
          userId:
            req.user
              .firebase_uid,

          learnoraUserId:
            req.user.id,

          skillId,

          syllabusId:
            enrollment
              .syllabus_id ||
            null,

          learnerLevel:
            result.level,

          topics:
            roadmap.topics,

          progress:
            0,

          source:
            roadmap.source,

          createdAt:
            new Date()
              .toISOString(),

          updatedAt:
            new Date()
              .toISOString()
        },
        {
          merge: true
        }
      );

    await recordActivity(
      req.user.id
    );

    req.flash(
      'success',
      `Assessment complete. Learnora placed you at ${
        result.level[0]
          .toUpperCase() +
        result.level.slice(1)
      } level.`
    );

    res.redirect(
      `/skill/${skillId}/roadmap`
    );
  }
);


/* =========================================================
   ROADMAP PAGE
========================================================= */

app.get(
  '/skill/:skillId/roadmap',
  loginRequired,
  async (
    req,
    res
  ) => {
    const skillId =
      req.params.skillId;

    const enrollment =
      await getEnrollment(
        req.user.id,
        skillId
      );

    if (!enrollment) {
      return res.redirect(
        `/skill/${skillId}/start`
      );
    }

    let plan = {};

    try {
      plan =
        JSON.parse(
          enrollment
            .roadmap_json ||
          '{}'
        );
    } catch {}

    const selected =
      new Set(
        plan.selected_topic_ids ||
          SKILLS[
            skillId
          ].topics
      );

    const progressRows =
      await getProgress(
        req.user.id,
        skillId
      );

    // AI Match is real topic mastery, calculated only from this student's
    // stored learning/assessment evidence. Recommendation metrics remain
    // separate from mastery.
    const masteryMap =
      calculateMasteryMap(
        progressRows,
        skillId,
        [...selected]
      );

    // Only >=90% demonstrated mastery counts as mastered for the roadmap.
    const mastered =
      new Set(
        [...selected].filter(
          topicId =>
            Number(
              masteryMap[topicId] || 0
            ) >= 90
        )
      );

    const road =
      buildRoadmap(
        skillId,
        mastered
      ).filter(
        x =>
          selected.has(
            x.topic_id
          ) &&
          x.difficulty >=
            threshold(
              enrollment
                .level ||
              'basic'
            )
      )
      .map(
        x => {
          const mastery =
            Number(
              masteryMap[
                x.topic_id
              ] || 0
            );

          return {
            ...x,
            mastery,
            mastery_status:
              masteryStatus(
                mastery
              ),
            // Keep prerequisite readiness separate from mastery.
            status:
              mastery >= 90
                ? 'mastered'
                : x.status
          };
        }
      );

    const recs =
      recommend(
        skillId,
        mastered,
        enrollment
          .hours_per_week ||
          5,
        5,
        masteryMap
      ).filter(
        x =>
          road.some(
            r =>
              r.topic_id ===
              x.topic_id
          )
      );

    res.render(
      'roadmap.html',
      {
        user:
          req.user,

        skill_id:
          skillId,

        skill:
          SKILLS[
            skillId
          ],

        roadmap:
          road,

        recommendations:
          recs,

        hours_per_week:
          enrollment
            .hours_per_week ||
          5,

        enrollment,

        plan,

        mastered_count:
          road.filter(
            x =>
              Number(
                x.mastery || 0
              ) >= 90
          ).length,

        // Course progress is the average of topic-level mastery values,
        // rather than the number of recommendation/roadmap-ready topics.
        pct:
          road.length
            ? Math.round(
                road.reduce(
                  (sum,x) =>
                    sum +
                    Number(
                      x.mastery || 0
                    ),
                  0
                ) /
                road.length
              )
            : 0
      }
    );
  }
);


/* =========================================================
   TOPIC PAGE
========================================================= */

app.get(
  '/skill/:skillId/topic/:topicId',
  loginRequired,
  async (
    req,
    res
  ) => {
    const {
      skillId,
      topicId
    } = req.params;

    if (
      !SKILLS[
        skillId
      ] ||
      !TOPIC_META[
        topicId
      ]
    ) {
      return res.redirect(
        '/dashboard'
      );
    }

    const enrollment =
      await getEnrollment(
        req.user.id,
        skillId
      );

    const meta =
      TOPIC_META[
        topicId
      ];

    if (
      enrollment &&
      meta.difficulty <
        threshold(
          enrollment
            .level ||
          'basic'
        )
    ) {
      req.flash(
        'info',
        `${meta.display} is below your detected level, so Learnora has skipped it.`
      );

      return res.redirect(
        `/skill/${skillId}/roadmap`
      );
    }

    const progressRows =
      await getProgress(
        req.user.id,
        skillId
      );

    const topicMasteryMap =
      calculateMasteryMap(
        progressRows,
        skillId,
        SKILLS[skillId].topics
      );

    const embedOrigin =
      `${req.protocol}://${req.get('host')}`;

    const videos =
      await getVideos(
        skillId,
        topicId,
        process.env
          .YOUTUBE_API_KEY,
        {
          masteryMap: topicMasteryMap,
          embedOrigin
        }
      );

    const docs =
      getDocs(
        topicId
      );

    const playlists =
      PLAYLISTS[
        skillId
      ] || [];

    const bank =
      COLD_START_QUESTIONS[
        topicId
      ] || [];

    const picked =
      bank
        .sort(
          () =>
            Math.random() -
            0.5
        )
        .slice(
          0,
          Math.min(
            3,
            bank.length
          )
        )
        .map(
          q => ({
            idx:
              bank.indexOf(
                q
              ),

            q:
              q.q,

            options:
              q.options
          })
        );

    res.render(
      'topic.html',
      {
        user:
          req.user,

        skill_id:
          skillId,

        skill:
          SKILLS[
            skillId
          ],

        topic_id:
          topicId,

        meta,

        videos,

        docs,

        languages:
          LANGUAGES,

        playlists,

        test_questions:
          picked
      }
    );
  }
);


/* =========================================================
   TOPIC TEST
========================================================= */

app.post(
  '/skill/:skillId/topic/:topicId',
  loginRequired,
  async (
    req,
    res
  ) => {
    const {
      skillId,
      topicId
    } = req.params;

    const bank =
      COLD_START_QUESTIONS[
        topicId
      ] || [];

    const ids =
      Array.isArray(
        req.body.qidx
      )
        ? req.body.qidx
        : [
            req.body.qidx
          ];

    const ans =
      Array.isArray(
        req.body.answer
      )
        ? req.body.answer
        : [
            req.body.answer
          ];

    let correct = 0;

    let total = 0;

    for (
      let i = 0;
      i < ids.length;
      i++
    ) {
      const qi =
        Number(
          ids[i]
        );

      const a =
        Number(
          ans[i]
        );

      if (
        Number.isInteger(
          qi
        ) &&
        bank[qi]
      ) {
        total++;

        if (
          bank[qi].answer ===
          a
        ) {
          correct++;
        }
      }
    }

    const frac =
      total
        ? correct /
          total
        : 0;

    await upsertProgress(
      req.user.id,
      skillId,
      topicId,
      frac >=
        0.9,

      frac,

      'post_video_test'
    );

    await recordActivity(
      req.user.id
    );

    req.flash(
      frac >= 0.9
        ? 'success'
        : 'warning',

      frac >= 0.9
        ? `Nice work! Your demonstrated mastery of ${TOPIC_META[topicId].display} is strong.`
        : `You scored ${Math.round(frac * 100)}% — review the material and try again when ready.`
    );

    res.redirect(
      `/skill/${skillId}/roadmap`
    );
  }
);


/* =========================================================
   PROFILE
========================================================= */

app.get(
  '/profile',
  loginRequired,
  async (
    req,
    res
  ) =>
    res.render(
      'profile.html',
      {
        user:
          req.user,

        prefs:
          await getPreferences(
            req.user.id
          )
      }
    )
);

app.post(
  '/profile',
  loginRequired,
  upload.single(
    'avatar'
  ),
  async (
    req,
    res
  ) => {
    const name =
      String(
        req.body.name ||
          ''
      ).trim();

    if (
      !/^[A-Za-z ]{2,50}$/.test(
        name
      )
    ) {
      req.flash(
        'danger',
        'Name can only contain letters and spaces.'
      );

      return res.redirect(
        '/profile'
      );
    }

    const phone =
      String(
        req.body.phone ||
          ''
      ).trim();

    if (
      phone &&
      !/^\d{7,15}$/.test(
        phone
      )
    ) {
      req.flash(
        'danger',
        'Phone number must be 7-15 digits.'
      );

      return res.redirect(
        '/profile'
      );
    }

    let avatarPath =
      req.user
        .avatar_path ||
      '';

    if (req.file) {
      const ext =
        path.extname(
          req.file
            .originalname ||
          ''
        ).toLowerCase();

      if (
        ![
          '.png',
          '.jpg',
          '.jpeg',
          '.webp',
          '.gif'
        ].includes(ext)
      ) {
        req.flash(
          'danger',
          'Profile photo must be PNG, JPG, JPEG, WEBP, or GIF.'
        );

        return res.redirect(
          '/profile'
        );
      }

      const object =
        `users/${req.user.firebase_uid}/avatars/${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;

      await putObject(
        object,
        req.file.buffer,
        req.file.mimetype ||
          'application/octet-stream'
      );

      avatarPath =
        object;
    }

    await updateUser(
      req.user.id,
      {
        name,

        age:
          req.body.age ||
          null,

        profession:
          String(
            req.body
              .profession ||
              ''
          ),

        phone,

        email:
          String(
            req.body.email ||
              req.user.email
          )
            .trim()
            .toLowerCase(),

        location:
          String(
            req.body.location ||
              'India'
          ),

        avatar_path:
          avatarPath
      }
    );

    await createNotification({
      audience: 'admin',
      type: 'profile_update',
      title: `${name} updated their profile`,
      message: `${req.user.email || 'A student'} changed their profile information.`,
      link: `/admin/student/${req.user.id}`,
      icon: 'user'
    });

    await updatePreferences(
      req.user.id,
      {
        learning_goal:
          String(
            req.body
              .learning_goal ||
              ''
          ),

        hours_per_week:
          Math.max(
            1,
            Math.min(
              30,
              Number(
                req.body
                  .hours_per_week ||
                  5
              )
            )
          ),

        learning_style:
          String(
            req.body
              .learning_style ||
              'mixed'
          ),

        learning_focus:
          String(
            req.body
              .learning_focus ||
              ''
          )
      }
    );

    req.flash(
      'success',
      'Profile updated successfully.'
    );

    res.redirect(
      '/profile'
    );
  }
);


/* =========================================================
   SETTINGS
========================================================= */

app.get(
  '/settings',
  loginRequired,
  async (
    req,
    res
  ) =>
    res.render(
      'settings.html',
      {
        user:
          req.user,

        prefs:
          await getPreferences(
            req.user.id
          )
      }
    )
);

app.post(
  '/settings',
  loginRequired,
  async (
    req,
    res
  ) => {
    await updatePreferences(
      req.user.id,
      {
        theme:
          req.body.theme ||
          'system',

        reminders:
          'reminders' in
          req.body,

        streak_alerts:
          'streak_alerts' in
          req.body,

        product_updates:
          'product_updates' in
          req.body,

        auto_next:
          'auto_next' in
          req.body,

        show_completed:
          'show_completed' in
          req.body
      }
    );

    req.flash(
      'success',
      'Settings saved.'
    );

    res.redirect(
      '/settings'
    );
  }
);


/* =========================================================
   NOTIFICATIONS
========================================================= */

app.get(
  '/notifications',
  loginRequired,
  async (
    req,
    res
  ) => {
    const isAdmin =
      req.user.role === 'admin' ||
      req.user.is_admin === true ||
      req.firebaseUser?.admin === true;

    const notifications =
      await getNotifications(
        req.user.id,
        isAdmin,
        100
      );

    res.render(
      'notifications.html',
      {
        user:
          req.user,

        notifications,

        is_admin:
          isAdmin
      }
    );
  }
);


/* =========================================================
   HELP DESK - USER PAGE
========================================================= */

app.get(
  '/help',
  loginRequired,
  async (
    req,
    res
  ) => {
    try {
      const support_tickets =
        await getSupportTicketsForUser(
          req.user.id
        );

      res.render(
        'help.html',
        {
          user:
            req.user,

          support_tickets
        }
      );
    } catch (error) {
      console.error(
        '[help] Failed to load support tickets:',
        error
      );

      res.render(
        'help.html',
        {
          user:
            req.user,

          support_tickets:
            []
        }
      );
    }
  }
);


/* =========================================================
   HELP DESK - CREATE REQUEST
========================================================= */

app.post(
  '/help',
  loginRequired,
  upload.single('help_attachment'),
  async (
    req,
    res
  ) => {
    try {
      const message =
        String(
          req.body.message ||
            ''
        ).trim();

      if (!message) {
        req.flash(
          'danger',
          'Please describe your question before sending it.'
        );

        return res.redirect(
          '/help'
        );
      }

      const topic =
        String(
          req.body.topic ||
            'General help'
        ).trim();

      const priority =
        String(
          req.body.priority ||
            'normal'
        )
          .trim()
          .toLowerCase();

      let attachment = null;
      if (req.file) {
        const allowed = new Set([
          'image/png',
          'image/jpeg',
          'image/webp',
          'image/gif',
          'application/pdf',
          'text/plain',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ]);

        if (!allowed.has(req.file.mimetype)) {
          req.flash(
            'danger',
            'Attachment must be an image, PDF, TXT, DOC, or DOCX file.'
          );
          return res.redirect('/help');
        }

        const originalName = String(req.file.originalname || 'attachment')
          .replace(/[^a-zA-Z0-9._-]/g, '_')
          .slice(-120);
        const ext = originalName.includes('.')
          ? originalName.slice(originalName.lastIndexOf('.')).toLowerCase()
          : '';
        const objectPath =
          `support/${req.user.firebase_uid || req.user.id}/attachments/${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;

        await putObject(
          objectPath,
          req.file.buffer,
          req.file.mimetype || 'application/octet-stream'
        );

        attachment = {
          path: objectPath,
          name: originalName,
          content_type: req.file.mimetype || 'application/octet-stream',
          size: req.file.size || 0
        };
      }

      const ticketId =
        await createSupportTicket(
          req.user.id,
          topic,
          message,
          priority,
          attachment
        );

      await createNotification({
        audience: 'admin',
        type: 'help_request',
        title: `New help request from ${req.user.name || 'student'}`,
        message: `${topic} • ${priority.toUpperCase()}: ${message.slice(0, 140)}${message.length > 140 ? '…' : ''}`,
        link: '/admin/helpdesk',
        icon: 'headset'
      });

      req.flash(
        'success',
        'Your question has been sent to the Learnora help desk.'
      );

      return res.redirect(
        '/help'
      );

    } catch (error) {
      console.error(
        '[help] Support ticket creation failed:',
        error
      );

      req.flash(
        'danger',
        'We could not send your support request. Please try again.'
      );

      return res.redirect(
        '/help'
      );
    }
  }
);


app.get(
  '/api/helpdesk/tickets',
  loginRequired,
  async (req, res) => {
    try {
      const tickets = await getSupportTicketsForUser(req.user.id);
      res.json({ ok: true, tickets });
    } catch (error) {
      console.error('[help] Failed to load support tickets:', error);
      res.status(500).json({ ok: false, tickets: [], error: 'Failed to load support requests.' });
    }
  }
);


/* =========================================================
   AVATAR
========================================================= */

app.get(
  '/api/avatar/:userId',
  loginRequired,
  async (
    req,
    res
  ) => {
    if (
      req.params.userId !==
        req.user.id &&
      req.user.role !==
        'admin' &&
      req.user.is_admin !==
        true
    ) {
      return res.status(
        403
      ).end();
    }

    const u =
      await (
        await import(
          './services/firebaseService.js'
        )
      ).getUser(
        req.params.userId
      );

    if (!u?.avatar_path) {
      return res
        .status(404)
        .end();
    }

    try {
      const object =
        await getObject(
          u.avatar_path
        );

      if (!object) {
        return res
          .status(404)
          .end();
      }

      res.set(
        'Content-Type',
        object.contentType ||
          'image/jpeg'
      );

      if (
        object.contentLength
      ) {
        res.set(
          'Content-Length',
          object.contentLength
        );
      }

      object.body
        ?.on(
          'error',
          () =>
            res.end()
        )
        .pipe(res);

    } catch (
      error
    ) {
      console.error(
        '[avatar] Storage read failed:',
        error
      );

      res
        .status(404)
        .end();
    }
  }
);


/* =========================================================
   CHATBOT
========================================================= */

app.post(
  '/api/chatbot',
  loginRequired,
  (
    req,
    res
  ) =>
    res.json({
      reply:
        chatbotAnswer(
          req.body.message,
          req.body.topic
        )
    })
);


/* =========================================================
   LEARNING EXPLANATION
========================================================= */

app.post(
  '/api/learning-explanation',
  loginRequired,
  async (
    req,
    res
  ) => {
    const id =
      req.body.topicId;

    if (!TOPIC_META[id]) {
      return res
        .status(400)
        .json({
          ok: false,
          error:
            'Unknown topic.'
        });
    }

    try {
      return res.json({
        ok: true,

        ...await generateLearningExplanation(
          {
            topic:
              TOPIC_META[
                id
              ],

            context:
              req.body
                .context ||
              ''
          }
        )
      });

    } catch (e) {
      return res
        .status(502)
        .json({
          ok: false,
          error:
            e.message
        });
    }
  }
);


/* =========================================================
   TRANSCRIPT
========================================================= */

app.get(
  '/api/transcript',
  loginRequired,
  async (
    req,
    res
  ) => {
    if (
      !req.query.video_id
    ) {
      return res
        .status(400)
        .json({
          ok: false,

          lines: [],

          error:
            'Missing video_id'
        });
    }

    res.json(
      await getTranscript(
        req.query.video_id,
        req.query.lang ||
          'en'
      )
    );
  }
);


/* =========================================================
   PLAYLIST JUMP
========================================================= */

app.get(
  '/api/playlist-jump',
  loginRequired,
  async (
    req,
    res
  ) => {
    const topic =
      TOPIC_META[
        req.query
          .topic_id
      ];

    if (!topic) {
      return res.json({
        ok: false,
        video_id:
          null
      });
    }

    const result =
      await getPlaylistJump(
        req.query
          .playlist_id,

        topic.display,

        topic.keywords,

        process.env
          .YOUTUBE_API_KEY
      );

    res.json(
      result
        ? {
            ok: true,
            ...result
          }
        : {
            ok: false,
            video_id:
              null
          }
    );
  }
);


/* =========================================================
   ADMIN DASHBOARD
   NOW ALSO LOADS HELP DESK REQUESTS
========================================================= */

app.get(
  '/admin',
  adminRequired,
  async (
    req,
    res
  ) => {
    const users =
      await allUsers();

    const student_rows =
      [];

    let total_enrollments =
      0;

    let active_learners =
      0;

    for (
      const u
      of users
    ) {
      const student = await ensureStudentAccountStatus(u.id);
      const studentUser = student || u;
      const enrollments =
        await getEnrollments(
          u.id
        );

      total_enrollments +=
        enrollments.length;

      if (
        enrollments.length
      ) {
        active_learners++;
      }

      const skills_summary =
        [];

      for (
        const e
        of enrollments
      ) {
        const mastered =
          await getMastered(
            u.id,
            e.skill_id
          );

        const total =
          SKILLS[
            e.skill_id
          ]
            ?.topics
            .length ||
          0;

        skills_summary.push(
          `${
            SKILLS[
              e.skill_id
            ]
              ?.display_name ||
            e.skill_id
          } (${mastered.size}/${total})`
        );
      }

      student_rows.push({
        user:
          studentUser,

        skills_summary,

        num_skills:
          enrollments.length
      });
    }

    res.render(
      'admin_dashboard.html',
      {
        student_rows,
        total_enrollments,
        active_learners
      }
    );
  }
);


/* =========================================================
   ADMIN HELP DESK - DEDICATED PAGE
========================================================= */

app.get(
  '/admin/helpdesk',
  adminRequired,
  async (req, res) => {
    try {
      const support_tickets = await getSupportTickets();
      return res.render('admin_helpdesk.html', {
        support_tickets
      });
    } catch (error) {
      console.error('[admin] Failed to load Help Desk page:', error);
      return res.status(500).send('Failed to load Help Desk.');
    }
  }
);

app.get(
  '/api/admin/support-tickets/:ticketId',
  adminRequired,
  async (req, res) => {
    try {
      const ticket = await getSupportTicket(req.params.ticketId);
      if (!ticket) {
        return res.status(404).json({ ok: false, error: 'Support request not found.' });
      }
      return res.json({ ok: true, ticket });
    } catch (error) {
      console.error('[admin] Failed to load support ticket:', error);
      return res.status(500).json({ ok: false, error: 'Failed to load support request.' });
    }
  }
);

app.post(
  '/admin/support/:ticketId/review',
  adminRequired,
  async (req, res) => {
    try {
      const ticket = await markSupportTicketReviewed(
        req.params.ticketId,
        req.user.id
      );

      if (!ticket) {
        return res.status(404).json({ ok: false, error: 'Support request not found.' });
      }

      return res.json({ ok: true, ticket });
    } catch (error) {
      console.error('[admin] Mark support ticket reviewed failed:', error);
      return res.status(500).json({
        ok: false,
        error: error.message || 'Failed to record request review.'
      });
    }
  }
);

app.post(
  '/admin/support/:ticketId/update',
  adminRequired,
  async (req, res) => {
    try {
      const ticketId = String(req.params.ticketId || '').trim();
      const adminMessage = String(req.body?.admin_message || '').trim();
      const status = req.body?.status ? String(req.body.status).trim().toLowerCase() : undefined;
      const priority = req.body?.priority ? String(req.body.priority).trim().toLowerCase() : undefined;

      if (!ticketId) {
        return res.status(400).json({ ok: false, error: 'Support request ID is required.' });
      }

      const allowedStatuses = new Set(['open', 'under_review', 'approved', 'resolved', 'rejected']);
      const allowedPriorities = new Set(['normal', 'important', 'urgent']);

      if (status && !allowedStatuses.has(status)) {
        return res.status(400).json({ ok: false, error: 'Invalid support request status.' });
      }
      if (priority && !allowedPriorities.has(priority)) {
        return res.status(400).json({ ok: false, error: 'Invalid support request priority.' });
      }

      const existing = await getSupportTicket(ticketId);
      if (!existing) {
        return res.status(404).json({ ok: false, error: 'Support request not found.' });
      }

      const ticket = await updateSupportTicketAdmin(ticketId, {
        adminUserId: req.user.id,
        adminMessage,
        status,
        priority
      });

      if (adminMessage) {
        await createNotification({
          userId: existing.user_id,
          audience: 'user',
          type: 'help_reply',
          title: 'Learnora support replied to your request',
          message: adminMessage.slice(0, 180) + (adminMessage.length > 180 ? '…' : ''),
          link: '/help',
          icon: 'headset'
        });
      }

      if (status && status !== existing.status) {
        await createNotification({
          userId: existing.user_id,
          audience: 'user',
          type: 'help_status',
          title: 'Your Learnora support request was updated',
          message: `Status: ${status.replace('_', ' ')}`,
          link: '/help',
          icon: 'headset'
        });
      }

      return res.json({ ok: true, ticket });
    } catch (error) {
      console.error('[admin] Update support ticket failed:', error);
      return res.status(500).json({
        ok: false,
        error: error.message || 'Failed to update support request.'
      });
    }
  }
);

app.delete(
  '/admin/support/:ticketId/history',
  adminRequired,
  async (req, res) => {
    try {
      const ticket = await getSupportTicket(req.params.ticketId);
      if (!ticket) return res.status(404).json({ ok: false, error: 'Support request not found.' });

      const deleted = await deleteSupportTicket(req.params.ticketId);
      if (!deleted) return res.status(404).json({ ok: false, error: 'Support request not found.' });

      return res.json({ ok: true });
    } catch (error) {
      console.error('[admin] Delete Help Desk history request failed:', error);
      return res.status(500).json({ ok: false, error: 'Failed to delete the history request.' });
    }
  }
);


app.get(
  '/api/helpdesk/tickets/:ticketId/attachment',
  loginRequired,
  async (req, res) => {
    try {
      const ticket = await getSupportTicket(req.params.ticketId);
      if (!ticket || String(ticket.user_id) !== String(req.user.id)) {
        return res.status(403).end();
      }
      if (!ticket.attachment?.path) return res.status(404).end();

      const object = await getObject(ticket.attachment.path);
      if (!object) return res.status(404).end();

      res.set('Content-Type', object.contentType || ticket.attachment.content_type || 'application/octet-stream');
      if (object.contentLength) res.set('Content-Length', object.contentLength);
      return object.body?.pipe(res);
    } catch (error) {
      console.error('[help] Support attachment read failed:', error);
      return res.status(404).end();
    }
  }
);

app.get(
  '/api/admin/support/:ticketId/attachment',
  adminRequired,
  async (req, res) => {
    try {
      const ticket = await getSupportTicket(req.params.ticketId);
      if (!ticket?.attachment?.path) return res.status(404).end();

      const object = await getObject(ticket.attachment.path);
      if (!object) return res.status(404).end();

      res.set('Content-Type', object.contentType || ticket.attachment.content_type || 'application/octet-stream');
      if (object.contentLength) res.set('Content-Length', object.contentLength);
      return object.body?.pipe(res);
    } catch (error) {
      console.error('[admin] Support attachment read failed:', error);
      return res.status(404).end();
    }
  }
);


/* =========================================================
   ADMIN HELP DESK - APPROVE + SEND MESSAGE
========================================================= */


app.post(
  '/admin/support/:ticketId/approve',
  adminRequired,
  async (
    req,
    res
  ) => {
    try {
      const ticketId =
        String(
          req.params.ticketId || ''
        ).trim();

      const adminMessage =
        String(
          req.body.admin_message || ''
        ).trim();

      if (!ticketId) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              'Support request ID is required.'
          });
      }

      if (!adminMessage) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              'Please enter a message before approving the request.'
          });
      }

      const ticket =
        await approveSupportTicket(
          ticketId,
          adminMessage,
          req.user.id
        );

      if (!ticket) {
        return res
          .status(404)
          .json({
            ok: false,
            error:
              'Support request not found.'
          });
      }

      const ticketUser =
        await getUser(
          ticket.user_id
        );

      const studentNotificationId =
        ticketUser?.id || ticket.user_id;

      await createNotification({
        userId: studentNotificationId,
        audience: 'user',
        type: 'help_reply',
        title: 'Learnora support replied to your request',
        message: adminMessage.slice(0, 180) + (adminMessage.length > 180 ? '…' : ''),
        link: '/help',
        icon: 'headset'
      });

      return res.json({
        ok: true,
        ticket
      });
    } catch (error) {
      console.error(
        '[admin] Approve support ticket failed:',
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message ||
            'Failed to approve support request.'
        });
    }
  }
);


/* =========================================================
   ADMIN HELP DESK - DELETE
========================================================= */

app.post(
  '/admin/support/:ticketId/delete',
  adminRequired,
  async (
    req,
    res
  ) => {
    try {
      const deleted =
        await deleteSupportTicket(
          req.params.ticketId
        );

      if (!deleted) {
        return res
          .status(404)
          .json({
            ok: false,
            error:
              'Support request not found.'
          });
      }

      return res.json({
        ok: true
      });
    } catch (error) {
      console.error(
        '[admin] Delete support ticket failed:',
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            'Failed to delete support request.'
        });
    }
  }
);


/* =========================================================
   ADMIN STUDENT
========================================================= */

app.get(
  '/admin/student/:userId',
  adminRequired,
  async (
    req,
    res
  ) => {
    const user =
      await (
        await import(
          './services/firebaseService.js'
        )
      ).getUser(
        req.params.userId
      );

    if (!user) {
      req.flash(
        'danger',
        'Student not found.'
      );

      return res.redirect(
        '/admin'
      );
    }

    const studentWithStatus = await ensureStudentAccountStatus(user.id);

    const details =
      [];

    for (
      const e
      of await getEnrollments(
        user.id
      )
    ) {
      const mastered =
        await getMastered(
          user.id,
          e.skill_id
        );

      details.push({
        skill_id:
          e.skill_id,

        display_name:
          SKILLS[
            e.skill_id
          ]
            ?.display_name ||
          e.skill_id,

        hours_per_week:
          e.hours_per_week,

        roadmap:
          buildRoadmap(
            e.skill_id,
            mastered
          ),

        progress_rows:
          await getProgress(
            user.id,
            e.skill_id
          )
      });
    }

    res.render(
      'admin_student.html',
      {
        user: studentWithStatus || user,

        details,

        streak:
          await streakInfo(
            user.id
          )
      }
    );
  }
);


/* =========================================================
   PPT UPLOAD / ADMIN-CONTROLLED CURRENT PRESENTATION
========================================================= */

const pptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

const PPT_ALLOWED_TYPES = new Map([
  ['.ppt', 'application/vnd.ms-powerpoint'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.pdf', 'application/pdf']
]);

function pptIsAdmin(req) {
  return Boolean(req.user && (req.user.role === 'admin' || req.user.is_admin === true));
}

async function getPptDocuments({ includeAll = false } = {}) {
  let query = db.collection('ppt_uploads');
  if (!includeAll) query = query.where('is_current', '==', true).limit(1);
  const snapshot = await query.get();
  const rows = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  if (!includeAll) return rows[0] || null;
  rows.sort((a, b) => String(b.uploaded_at || '').localeCompare(String(a.uploaded_at || '')));
  return rows;
}

async function getPptViewerUrl(ppt) {
  if (!ppt?.storage_path) return null;
  return createSignedUrl(ppt.storage_path, 3600);
}

app.get(
  '/ppt-upload',
  optionalAuth,
  async (req, res) => {
    let presentations = [];
    let currentPresentation = null;
    let viewerUrl = null;
    try {
      const isAdmin = pptIsAdmin(req);
      currentPresentation = await getPptDocuments({ includeAll: false });
      if (currentPresentation) viewerUrl = await getPptViewerUrl(currentPresentation);
      if (isAdmin) presentations = await getPptDocuments({ includeAll: true });
    } catch (error) {
      console.error('[ppt] Failed to load presentation data:', error.message);
      req.flash('danger', 'Unable to load the presentation library right now.');
    }

    res.render('ppt_upload.html', {
      presentations,
      current_presentation: currentPresentation,
      viewer_url: viewerUrl,
      can_upload: pptIsAdmin(req),
      is_admin: pptIsAdmin(req)
    });
  }
);

app.post(
  '/ppt-upload',
  adminRequired,
  pptUpload.single('ppt_file'),
  async (req, res) => {
    try {
      if (!req.file) {
        req.flash('danger', 'Please choose a presentation or PDF file.');
        return res.redirect('/ppt-upload');
      }

      const originalName = String(req.file.originalname || 'presentation.pptx')
        .replace(/[^a-zA-Z0-9._() -]/g, '_')
        .trim()
        .slice(-180);
      const ext = path.extname(originalName).toLowerCase();
      const contentType = PPT_ALLOWED_TYPES.get(ext);
      if (!contentType) {
        req.flash('danger', 'Only PPT, PPTX, and PDF files are supported.');
        return res.redirect('/ppt-upload');
      }

      const objectPath = `presentations/${req.user.firebase_uid || req.user.id}/${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
      await putObject(objectPath, req.file.buffer, req.file.mimetype || contentType);

      const uploadedAt = new Date().toISOString();
      await db.collection('ppt_uploads').add({
        original_name: originalName,
        file_type: ext.slice(1).toUpperCase(),
        storage_path: objectPath,
        content_type: req.file.mimetype || contentType,
        size: req.file.size || 0,
        uploaded_at: uploadedAt,
        updated_at: uploadedAt,
        uploaded_by: String(req.user.id),
        uploaded_by_name: req.user.name || req.user.email || 'Admin',
        uploaded_by_email: req.user.email || '',
        is_current: false
      });

      req.flash('success', `File uploaded successfully: ${originalName}`);
      return res.redirect('/ppt-upload');
    } catch (error) {
      console.error('[ppt] Upload failed:', error);
      req.flash('danger', error.message || 'Presentation upload failed.');
      return res.redirect('/ppt-upload');
    }
  }
);

app.post(
  '/ppt-upload/set-current/:id',
  adminRequired,
  async (req, res) => {
    try {
      const selectedRef = db.collection('ppt_uploads').doc(String(req.params.id));
      const selected = await selectedRef.get();
      if (!selected.exists) {
        req.flash('danger', 'Presentation not found.');
        return res.redirect('/ppt-upload');
      }

      const batch = db.batch();
      const all = await db.collection('ppt_uploads').get();
      const now = new Date().toISOString();
      all.docs.forEach(doc => {
        batch.update(doc.ref, {
          is_current: doc.id === selected.id,
          updated_at: now
        });
      });
      await batch.commit();

      req.flash('success', `${selected.data().original_name || 'Presentation'} is now displayed to students.`);
      return res.redirect('/ppt-upload');
    } catch (error) {
      console.error('[ppt] Set current failed:', error.message);
      req.flash('danger', 'Unable to change the current presentation.');
      return res.redirect('/ppt-upload');
    }
  }
);

app.get(
  '/ppt-upload/view/:id',
  optionalAuth,
  async (req, res) => {
    try {
      const doc = await db.collection('ppt_uploads').doc(String(req.params.id)).get();
      if (!doc.exists) return res.status(404).send('Presentation not found.');
      const ppt = { id: doc.id, ...doc.data() };
      const isAdmin = pptIsAdmin(req);
      if (!ppt.is_current && !isAdmin) return res.status(403).send('This presentation is not currently available.');

      const object = await getObject(ppt.storage_path);
      if (!object || !object.body) return res.status(404).send('Presentation file not found.');

      res.setHeader('Content-Type', ppt.content_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${String(ppt.original_name || 'presentation').replace(/"/g, '')}"`);
      res.setHeader('Cache-Control', 'private, max-age=300');
      if (ppt.size) res.setHeader('Content-Length', String(ppt.size));
      object.body.pipe(res);
    } catch (error) {
      console.error('[ppt] View failed:', error.message);
      res.status(500).send('Unable to view presentation.');
    }
  }
);

app.get(
  '/ppt-upload/download/:id',
  optionalAuth,
  async (req, res) => {
    try {
      const doc = await db.collection('ppt_uploads').doc(String(req.params.id)).get();
      if (!doc.exists) return res.status(404).send('Presentation not found.');
      const ppt = doc.data();
      if (!ppt.is_current && !pptIsAdmin(req)) return res.status(403).send('This presentation is not currently available.');

      const object = await getObject(ppt.storage_path);
      if (!object || !object.body) return res.status(404).send('Presentation file not found.');

      res.setHeader('Content-Type', ppt.content_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${String(ppt.original_name || 'presentation').replace(/"/g, '')}"`);
      if (ppt.size) res.setHeader('Content-Length', String(ppt.size));
      object.body.pipe(res);
    } catch (error) {
      console.error('[ppt] Download failed:', error.message);
      res.status(500).send('Unable to download presentation.');
    }
  }
);

// Keep old bookmarks working, but the Research section itself is removed.
app.get('/admin/research', adminRequired, (req, res) => res.redirect('/ppt-upload'));
app.post('/admin/research/run', adminRequired, (req, res) => res.redirect('/ppt-upload'));


/* =========================================================
   API
========================================================= */

app.get(
  '/api/notifications',
  loginRequired,
  async (
    req,
    res
  ) => {
    try {
      const isAdmin =
        req.user.role === 'admin' ||
        req.user.is_admin === true ||
        req.firebaseUser?.admin === true;

      const notifications =
        await getNotifications(
          req.user.id,
          isAdmin,
          Number(req.query.limit || 50)
        );

      res.json({
        ok: true,
        notifications,
        unread_count:
          notifications.filter(
            notification => !notification.read
          ).length
      });
    } catch (error) {
      console.error(
        '[notifications] Load failed:',
        error
      );

      res.status(500).json({
        ok: false,
        notifications: [],
        unread_count: 0
      });
    }
  }
);


app.post(
  '/api/notifications/:notificationId/read',
  loginRequired,
  async (
    req,
    res
  ) => {
    try {
      const isAdmin =
        req.user.role === 'admin' ||
        req.user.is_admin === true ||
        req.firebaseUser?.admin === true;

      const updated =
        await markNotificationRead(
          req.params.notificationId,
          req.user.id,
          isAdmin
        );

      if (!updated) {
        return res.status(404).json({
          ok: false,
          error: 'Notification not found.'
        });
      }

      res.json({
        ok: true
      });
    } catch (error) {
      console.error(
        '[notifications] Mark read failed:',
        error
      );

      res.status(500).json({
        ok: false,
        error: 'Could not mark notification as read.'
      });
    }
  }
);


app.post(
  '/api/notifications/clear-all',
  loginRequired,
  async (req, res) => {
    try {
      const isAdmin =
        req.user.role === 'admin' ||
        req.user.is_admin === true ||
        req.firebaseUser?.admin === true;

      const count = await clearAllNotifications(req.user.id, isAdmin);

      res.json({ ok: true, count });
    } catch (error) {
      console.error('[notifications] Clear all failed:', error);
      res.status(500).json({
        ok: false,
        error: 'Could not clear notifications.'
      });
    }
  }
);


app.post(
  '/api/notifications/read-all',
  loginRequired,
  async (
    req,
    res
  ) => {
    try {
      const isAdmin =
        req.user.role === 'admin' ||
        req.user.is_admin === true ||
        req.firebaseUser?.admin === true;

      const count =
        await markAllNotificationsRead(
          req.user.id,
          isAdmin
        );

      res.json({
        ok: true,
        count
      });
    } catch (error) {
      console.error(
        '[notifications] Mark all read failed:',
        error
      );

      res.status(500).json({
        ok: false,
        error: 'Could not mark notifications as read.'
      });
    }
  }
);


app.get(
  '/api/dashboard',
  loginRequired,
  async (
    req,
    res
  ) => {
    res.json({
      ok: true,

      user:
        req.user,

      streak:
        await streakInfo(
          req.user.id
        ),

      enrollments:
        await getEnrollments(
          req.user.id
        )
    });
  }
);


app.get(
  '/api/skills',
  loginRequired,
  (
    req,
    res
  ) =>
    res.json({
      ok: true,
      skills:
        SKILLS
    })
);


app.post(
  '/api/skills',
  adminRequired,
  async (
    req,
    res
  ) => {
    const {
      id,
      ...data
    } =
      req.body ||
      {};

    if (!id) {
      return res
        .status(400)
        .json({
          ok: false,
          error:
            'Skill id required'
        });
    }

    await db
      .collection(
        'skills'
      )
      .doc(id)
      .set(
        {
          skill_id:
            id,

          ...data
        },
        {
          merge: true
        }
      );

    res
      .status(201)
      .json({
        ok: true,
        id
      });
  }
);


app.get(
  '/api/roadmap/:id',
  loginRequired,
  async (
    req,
    res
  ) => {
    const s =
      await db
        .collection(
          'roadmaps'
        )
        .doc(
          req.params.id
        )
        .get();

    if (!s.exists) {
      return res
        .status(404)
        .json({
          ok: false,
          error:
            'Roadmap not found'
        });
    }

    const d =
      s.data();

    if (
      d.learnoraUserId !==
        req.user.id &&
      d.userId !==
        req.user
          .firebase_uid &&
      req.user.role !==
        'admin'
    ) {
      return res
        .status(403)
        .json({
          ok: false,
          error:
            'Forbidden'
        });
    }

    res.json({
      ok: true,

      id:
        s.id,

      ...d
    });
  }
);


app.get(
  '/api/topics/:id',
  loginRequired,
  (
    req,
    res
  ) => {
    if (
      !TOPIC_META[
        req.params.id
      ]
    ) {
      return res
        .status(404)
        .json({
          ok: false,
          error:
            'Topic not found'
        });
    }

    res.json({
      ok: true,

      id:
        req.params.id,

      ...TOPIC_META[
        req.params.id
      ]
    });
  }
);


app.post(
  '/api/topics/:id/progress',
  loginRequired,
  async (
    req,
    res
  ) => {
    const skillId =
      req.body.skillId;

    if (
      !SKILLS[
        skillId
      ]?.topics.includes(
        req.params.id
      )
    ) {
      return res
        .status(400)
        .json({
          ok: false,
          error:
            'Invalid skill/topic'
        });
    }

    await upsertProgress(
      req.user.id,
      skillId,
      req.params.id,
      Boolean(
        req.body.completed
      ),
      Number(
        req.body.percentage ||
        0
      ),
      'api'
    );

    await recordActivity(
      req.user.id
    );

    res.json({
      ok: true
    });
  }
);


app.get(
  '/api/profile',
  loginRequired,
  (
    req,
    res
  ) =>
    res.json({
      ok: true,

      user:
        req.user,

      prefs:
        null
    })
);


app.put(
  '/api/profile',
  loginRequired,
  async (
    req,
    res
  ) => {
    await updateUser(
      req.user.id,
      {
        name:
          req.body.name,

        profession:
          req.body.profession,

        phone:
          req.body.phone,

        location:
          req.body.location
      }
    );

    await createNotification({
      audience: 'admin',
      type: 'profile_update',
      title: `${req.body.name || req.user.name || 'A student'} updated their profile`,
      message: `${req.user.email || 'A student'} changed their profile information.`,
      link: `/admin/student/${req.user.id}`,
      icon: 'user'
    });

    res.json({
      ok: true
    });
  }
);


/* =========================================================
   ADMIN STUDENTS API
========================================================= */

app.get(
  '/api/admin/students',
  adminRequired,
  async (
    req,
    res
  ) => {
    res.json({
      ok: true,

      students:
        await allUsers()
    });
  }
);


app.get(
  '/api/admin/students/:id',
  adminRequired,
  async (
    req,
    res
  ) => {
    const u =
      await (
        await import(
          './services/firebaseService.js'
        )
      ).getUser(
        req.params.id
      );

    if (!u) {
      return res
        .status(404)
        .json({
          ok: false,
          error:
            'Student not found'
        });
    }

    res.json({
      ok: true,

      user:
        u,

      enrollments:
        await getEnrollments(
          u.id
        )
    });
  }
);


/* =========================================================
   ADMIN STUDENT ACCOUNT CONTROLS
========================================================= */

app.post(
  '/api/admin/students/:id/account-status',
  adminRequired,
  async (req, res) => {
    try {
      const status = String(req.body?.status || '').trim().toLowerCase();
      const reason = String(req.body?.reason || '').trim();
      const allowed = new Set(['active', 'suspended', 'restricted', 'terminated']);

      if (!allowed.has(status)) {
        return res.status(400).json({ ok: false, error: 'Invalid account status.' });
      }

      if (status !== 'active' && !reason) {
        return res.status(400).json({ ok: false, error: 'A reason is required for this action.' });
      }

      const user = await updateStudentAccountStatus(req.params.id, status, {
        adminUserId: req.user.id,
        reason
      });

      if (!user) {
        return res.status(404).json({ ok: false, error: 'Student not found.' });
      }

      await createNotification({
        userId: user.id,
        audience: 'user',
        type: 'account_status',
        title: `Learnora account status: ${status}`,
        message: status === 'active'
          ? 'Your Learnora account has been reactivated.'
          : `Your Learnora account is now ${status}.`,
        link: status === 'active' ? '/dashboard' : '/login',
        icon: 'shield'
      }).catch(() => {});

      return res.json({ ok: true, user });
    } catch (error) {
      console.error('[admin] Student account status update failed:', error);
      return res.status(500).json({ ok: false, error: error.message || 'Failed to update student account.' });
    }
  }
);


/* =========================================================
   ADMIN SUPPORT TICKETS API
   Useful for AJAX refresh in the future
========================================================= */

app.get(
  '/api/admin/support-tickets',
  adminRequired,
  async (
    req,
    res
  ) => {
    try {
      return res.json({
        ok: true,

        tickets:
          await getSupportTickets()
      });

    } catch (
      error
    ) {
      console.error(
        '[admin] Failed to load support tickets:',
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            'Failed to load support tickets.'
        });
    }
  }
);


/* =========================================================
   INITIALIZE FIRESTORE SKILLS
========================================================= */

await ensureSkillDocuments(
  SKILLS
);


/* =========================================================
   ERROR HANDLING
========================================================= */

app.use(
  notFound
);

app.use(
  errorHandler
);


/* =========================================================
   LOCAL SERVER / VERCEL
========================================================= */

if (
  !process.env.VERCEL
) {
  app.listen(
    PORT,
    () =>
      console.log(
        `Learnora JS server running at http://localhost:${PORT}`
      )
  );
}


export default app;