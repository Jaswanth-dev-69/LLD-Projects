# Taxi Booking System (Python)

## Project Overview

This project is a console-based Taxi Booking System implemented in Python. It simulates how a basic taxi service (similar to Ola/Uber at a design level) works by assigning the nearest available taxi to a user based on pickup location, calculating fare, and managing taxi availability.

The project is implemented in two approaches:

- **Procedural Programming**
- **Object-Oriented Programming (OOP)**

The goal of this project is to understand system flow, state management, and OOP concepts. This is a learning-focused implementation, not a production-ready application.

---

## Features

- User inputs pickup and drop locations
- City modeled as locations from 1 to 10
- Distance calculated as absolute difference between locations
- Nearest available taxi is allocated to the user
- Fare calculation based on distance travelled
- Taxi availability persists across multiple bookings
- Taxi location updates to drop location after each trip
- Graceful handling when all taxis are booked
- Input validation for:
  - Invalid locations (outside 1-10 range)
  - Same pickup and drop location

---

## Project Structure

```
TAXIBOOKINGSYSTEM/
|
|-- taxi.py       # Procedural implementation
|-- taxii.py      # Object-Oriented (OOP) implementation
|-- README.md     # Project documentation
```

---

## Assumptions and Constraints

| Constraint | Value |
|------------|-------|
| Total number of taxis | 5 |
| Location range | 1 to 10 |
| Taxis per ride | 1 taxi handles 1 ride at a time |
| Taxi release | Taxis remain unavailable after booking (no release logic) |
| Distance unit | Assumed to be kilometers |
| External dependencies | None (no database or API) |
| Execution environment | Console/Terminal |

**Initial Taxi Positions:**

| Taxi ID | Starting Location |
|---------|-------------------|
| 1       | 2 |
| 2       | 5 |
| 3       | 7 |
| 4       | 9 |
| 5       | 1 |

---

## Fare Calculation Logic

The fare is calculated using a simple formula:

```
Total Fare = Base Fare + (Distance x Per KM Rate)
```

| Component | Value |
|-----------|-------|
| Base Fare | 50 (currency units) |
| Per KM Rate | 20 (currency units) |

**Example:**
- Pickup Location: 2
- Drop Location: 5
- Distance: |5 - 2| = 3 km
- Fare: 50 + (3 x 20) = 110

---

## Implementation Approaches

### 1. Procedural Approach

**File:** `taxi.py`

- Uses a list of dictionaries to represent taxis
- Each taxi is a dictionary with keys: `id`, `curr_location`, `available`
- Logic is written step-by-step using loops and conditions
- State is managed through direct dictionary manipulation
- Focuses on understanding program flow before applying OOP

**Key Characteristics:**
- Simple and straightforward
- All logic in a single script
- Good for validating core logic quickly

---

### 2. Object-Oriented Programming (OOP) Approach

**File:** `taxii.py`

Uses classes to model the system:

| Class | Responsibility |
|-------|----------------|
| `Taxi` | Represents a single taxi with id, location, and availability. Handles assignment logic. |
| `TaxiBookingSystem` | Manages the fleet of taxis and finds the nearest available taxi. |

**OOP Concepts Demonstrated:**
- **Encapsulation:** Taxi state (id, location, availability) is bundled within the Taxi class
- **Abstraction:** Booking system exposes `find_nearest_taxi()` method, hiding internal logic
- **Object State Management:** Each taxi object manages its own state independently

**Key Characteristics:**
- Modular and organized
- Easier to extend and maintain
- Better separation of concerns

---

## Sample Input/Output

### Successful Booking

```
Welcome to Taxi Booking Platform
Enter Pickup Location (1-10): 3
Enter Drop Location (1-10): 7

Taxi booked: 2
Travelled distance: 4
Fare: 130
Updated Taxi Info: {'id': 2, 'curr_location': 7, 'available': False}
```

### Multiple Bookings

```
Enter Pickup Location (1-10): 1
Enter Drop Location (1-10): 5

Taxi booked: 5
Travelled distance: 4
Fare: 130
Updated Taxi Info: {'id': 5, 'curr_location': 5, 'available': False}

Enter Pickup Location (1-10): 2
Enter Drop Location (1-10): 8

Taxi booked: 1
Travelled distance: 6
Fare: 170
Updated Taxi Info: {'id': 1, 'curr_location': 8, 'available': False}
```

### All Taxis Booked

```
Enter Pickup Location (1-10): 4
Enter Drop Location (1-10): 6

Sorry, all taxis are currently booked.
THANK YOU FOR USING THE SERVICE
```

### Invalid Input Handling

```
Enter Pickup Location (1-10): 15
Enter Drop Location (1-10): 3
Invalid pickup location. Enter between 1 and 10.

Enter Pickup Location (1-10): 3
Enter Drop Location (1-10): 3
Pickup and drop locations cannot be the same.
```

---

## Learning Outcomes

Through this project, I learned:

- How to model real-world problems in code
- How to manage state across multiple operations
- Difference between procedural programming and OOP
- Importance of input validation and edge case handling
- How `self`, classes, and objects work in Python
- How to find the nearest resource using simple distance calculation
- State persistence across iterations in a loop

---

## Possible Future Improvements

These features are **not currently implemented** but could be added to extend the project:

1. **Taxi Release Logic:** Mark taxi as available after completing a trip
2. **Time-Based Booking:** Consider pickup time for scheduling
3. **Multiple Passengers:** Allow taxis to handle queued bookings
4. **Surge Pricing:** Increase fare during peak hours
5. **Trip History:** Maintain a log of all completed trips
6. **User Ratings:** Add rating system for taxis/drivers
7. **Database Integration:** Persist taxi and booking data
8. **GUI/Web Interface:** Replace console with a graphical interface

---

## How to Run

1. Ensure Python 3.x is installed on your system
2. Navigate to the project folder
3. Run either implementation:

```bash
# Procedural version
python taxi.py

# OOP version
python taxii.py
```

---

## Author Notes

This project was built for learning purposes and to demonstrate understanding of:
- Low-Level Design (LLD) concepts
- State management in applications
- Transitioning from procedural to object-oriented thinking

It is suitable for understanding basic system design patterns.
