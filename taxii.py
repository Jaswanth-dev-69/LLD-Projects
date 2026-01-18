class Taxi:
    def __init__(self, taxi_id, curr_location):
        self.id = taxi_id
        self.curr_location = curr_location
        self.available = True

    def assign(self, drop_location):
        self.available = False
        self.curr_location = drop_location


class TaxiBookingSystem:
    def __init__(self):
        self.base_fare = 50
        self.taxis = [
            Taxi(1, 2),
            Taxi(2, 5),
            Taxi(3, 7),
            Taxi(4, 9),
            Taxi(5, 1)
        ]

    def find_nearest_taxi(self, pickup_location):
        min_dist = float('inf')
        booked_taxi = None

        for taxi in self.taxis:
            if taxi.available:
                dist = abs(taxi.curr_location - pickup_location)
                if dist < min_dist:
                    min_dist = dist
                    booked_taxi = taxi

        return booked_taxi


# ---------------- MAIN PROGRAM ----------------

print("Welcome to Taxi Booking Platform")

system = TaxiBookingSystem()

while True:
    pickup_location = int(input("Enter Pickup Location (1-10): "))
    drop_location = int(input("Enter Drop Location (1-10): "))

    if pickup_location < 1 or pickup_location > 10:
        print("Invalid pickup location. Enter between 1 and 10.")
        continue

    if drop_location < 1 or drop_location > 10:
        print("Invalid drop location. Enter between 1 and 10.")
        continue

    if pickup_location == drop_location:
        print("Pickup and drop locations cannot be the same.")
        continue

    booked_taxi = system.find_nearest_taxi(pickup_location)

    if booked_taxi is None:
        print("Sorry, all taxis are currently booked.")
        break

    distance = abs(drop_location - pickup_location)
    fare = system.base_fare + (distance * 20)

    print("Taxi booked:", booked_taxi.id)
    print("Travelled distance:", distance)
    print("Fare:", fare)

    booked_taxi.assign(drop_location)
    print("Updated Taxi Info:", {
        "id": booked_taxi.id,
        "curr_location": booked_taxi.curr_location,
        "available": booked_taxi.available
    })

print("THANK YOU FOR USING THE SERVICE")
