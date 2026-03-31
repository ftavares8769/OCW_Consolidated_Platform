from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, JSON, Float
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class Course(Base):
    __tablename__ = "courses"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    subject = Column(String)
    ocw_url = Column(String, unique=True, nullable=False)
    playlist_id = Column(String, nullable=True)
    description = Column(Text)
    course_number = Column(String)
    status = Column(String, default="pending")  # pending, importing, done, error
    created_at = Column(DateTime, default=func.now())

    lectures = relationship("Lecture", back_populates="course", cascade="all, delete-orphan")


class Lecture(Base):
    __tablename__ = "lectures"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)
    title = Column(String, nullable=False)
    youtube_url = Column(String)
    transcript_raw = Column(Text)
    transcript_clean = Column(Text)
    summary = Column(Text)
    order_index = Column(Integer, default=0)
    status = Column(String, default="pending")  # pending, fetching, cleaning, summarizing, done, error
    error_message = Column(Text, nullable=True)  # stores failure detail when status='error'
    created_at = Column(DateTime, default=func.now())

    course = relationship("Course", back_populates="lectures")
    resources = relationship("Resource", back_populates="lecture", cascade="all, delete-orphan")
    study_materials = relationship("StudyMaterial", back_populates="lecture", cascade="all, delete-orphan")
    flashcards = relationship("Flashcard", back_populates="lecture", cascade="all, delete-orphan")
    mistakes = relationship("MistakeRecord", back_populates="lecture", cascade="all, delete-orphan")


class Resource(Base):
    __tablename__ = "resources"

    id = Column(Integer, primary_key=True, index=True)
    lecture_id = Column(Integer, ForeignKey("lectures.id"), nullable=False)
    type = Column(String)  # slides, lecture_notes, problem_set, exam, reading, textbook, resource
    title = Column(String)
    url = Column(String)
    local_path = Column(String)
    lecture_number = Column(Integer, nullable=True)   # which lecture this file belongs to
    status = Column(String, default="pending")  # pending, downloading, done, not_found, error
    created_at = Column(DateTime, default=func.now())

    lecture = relationship("Lecture", back_populates="resources")


class StudyMaterial(Base):
    __tablename__ = "study_materials"

    id = Column(Integer, primary_key=True, index=True)
    lecture_id = Column(Integer, ForeignKey("lectures.id"), nullable=False)
    type = Column(String)  # flashcards, quiz, problems, notes
    content_json = Column(JSON)
    created_at = Column(DateTime, default=func.now())

    lecture = relationship("Lecture", back_populates="study_materials")


class Flashcard(Base):
    __tablename__ = "flashcards"

    id = Column(Integer, primary_key=True, index=True)
    lecture_id = Column(Integer, ForeignKey("lectures.id"), nullable=False)
    front = Column(Text, nullable=False)
    back = Column(Text, nullable=False)
    tags = Column(JSON, default=list)
    state = Column(String, default="new")           # new / learning / learned
    ease_factor = Column(Float, default=2.5)
    interval = Column(Integer, default=0)           # days until next review
    repetitions = Column(Integer, default=0)
    next_review_date = Column(String, nullable=True)  # ISO date "YYYY-MM-DD"
    last_reviewed = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=func.now())

    lecture = relationship("Lecture", back_populates="flashcards")


class MistakeRecord(Base):
    __tablename__ = "mistake_records"

    id             = Column(Integer, primary_key=True, index=True)
    lecture_id     = Column(Integer, ForeignKey("lectures.id"), nullable=False)
    question_text  = Column(Text, nullable=False)
    question_type  = Column(String, default="quiz")    # quiz | concept_quiz
    concept        = Column(String, nullable=True)     # e.g. "chain rule"
    correct_answer = Column(Text)
    wrong_answer   = Column(Text)
    options        = Column(JSON, nullable=True)       # all MCQ options list
    status         = Column(String, default="needs_review")  # needs_review | mastered
    created_at     = Column(DateTime, default=func.now())
    last_reviewed  = Column(DateTime, nullable=True)

    lecture = relationship("Lecture", back_populates="mistakes")


class DailyStats(Base):
    __tablename__ = "daily_stats"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(String, nullable=False, unique=True)  # "YYYY-MM-DD"
    cards_reviewed = Column(Integer, default=0)
    again_count = Column(Integer, default=0)
    hard_count = Column(Integer, default=0)
    good_count = Column(Integer, default=0)
    easy_count = Column(Integer, default=0)
    new_graduated = Column(Integer, default=0)      # new → learning transitions today
    learned_graduated = Column(Integer, default=0)  # learning → learned transitions today
